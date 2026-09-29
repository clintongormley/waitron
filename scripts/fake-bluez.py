# CI only, never installed on a box: a stand-in for BlueZ on the image-smoke runner's system bus,
# which has no Bluetooth hardware. Run as root with the bluez package installed: its bus policy is
# what lets root own `org.bluez` and call a pairing agent. It serves one powered adapter, a scan that
# finds one more device and reports a changed property, and four printers:
#   66:55:44:33:22:11  "CI Printer"        already paired.
#   86:67:7A:00:00:01  "BT Printer PIN"    legacy PIN pairing: `Device1.Pair` calls the caller's own
#                                          agent (else the default one) with
#                                          `org.bluez.Agent1.RequestPinCode` and succeeds only on
#                                          FAKE_BLUEZ_PIN (default 1234).
#   86:67:7A:00:00:02  "BT Printer NoPin"  pairs without asking an agent.
#   86:67:7A:00:00:03  "BT Printer Gone"   fails `ConnectionAttemptFailed` before any agent call.
# Every failure it chooses to report — a wrong PIN, no agent, an agent's error reply, and no reply
# within FAKE_BLUEZ_AGENT_TIMEOUT_MS (default 60000), after which it sends `Agent1.Cancel` — is
# `AuthenticationFailed`. That is its own choice, not what bluetoothd was measured to return.
# `RemoveDevice`, `Properties.Set` and each agent exchange print a `fake bluez:` line, so a check can
# tell whether a call reached it.
import os

import dbus
import dbus.mainloop.glib
import dbus.service
from gi.repository import GLib

dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
bus = dbus.SystemBus()
name = dbus.service.BusName("org.bluez", bus)
ADAPTER = "/org/bluez/hci0"
NO_UUIDS = dbus.Array([], signature="s")
SPP = "00001101-0000-1000-8000-00805f9b34fb"
PIN = os.environ.get("FAKE_BLUEZ_PIN", "1234")
AGENT_TIMEOUT_S = int(os.environ.get("FAKE_BLUEZ_AGENT_TIMEOUT_MS", "60000")) / 1000.0
DEVICE_IFACES = ["org.freedesktop.DBus.Introspectable", "org.bluez.Device1",
                 "org.freedesktop.DBus.Properties"]


def dev_path(mac):
    return ADAPTER + "/dev_" + mac.replace(":", "_")


def printer(mac, name, paired, mode):
    props = {
        "Address": mac, "AddressType": "public", "Name": name, "Alias": name,
        "Class": dbus.UInt32(0x00040680), "Icon": "printer",
        "Paired": paired, "Bonded": paired, "Trusted": False, "Blocked": False,
        "Connected": False, "LegacyPairing": mode == "pin",
        "Adapter": dbus.ObjectPath(ADAPTER), "UUIDs": dbus.Array([SPP], signature="s"),
    }
    return {"props": props, "mode": mode}


DEVICES = {
    dev_path("66:55:44:33:22:11"): printer("66:55:44:33:22:11", "CI Printer", True, "pin"),
    dev_path("86:67:7A:00:00:01"): printer("86:67:7A:00:00:01", "BT Printer PIN", False, "pin"),
    dev_path("86:67:7A:00:00:02"): printer("86:67:7A:00:00:02", "BT Printer NoPin", False, "justworks"),
    dev_path("86:67:7A:00:00:03"): printer("86:67:7A:00:00:03", "BT Printer Gone", False, "unreachable"),
}
# unique bus name -> agent object path; default agent as (owner, path)
AGENTS = {}
DEFAULT_AGENT = [None]


def log(msg):
    print("fake bluez: " + msg, flush=True)


class BluezError(dbus.DBusException):
    def __init__(self, name, message=""):
        super().__init__(message)
        self._dbus_error_name = "org.bluez.Error." + name


class Root(dbus.service.Object):
    @dbus.service.signal("org.freedesktop.DBus.ObjectManager", signature="oa{sa{sv}}")
    def InterfacesAdded(self, path, interfaces):
        pass

    @dbus.service.signal("org.freedesktop.DBus.ObjectManager", signature="oas")
    def InterfacesRemoved(self, path, interfaces):
        pass

    @dbus.service.method("org.freedesktop.DBus.ObjectManager", out_signature="a{oa{sa{sv}}}")
    def GetManagedObjects(self):
        objects = {
            dbus.ObjectPath("/org/bluez"): {"org.bluez.AgentManager1": {}},
            dbus.ObjectPath(ADAPTER): {
                "org.bluez.Adapter1": {
                    "Address": "00:11:22:33:44:55", "AddressType": "public", "Name": "waitron-ci",
                    "Alias": "waitron-ci", "Class": dbus.UInt32(0), "Powered": True,
                    "Discoverable": False, "Pairable": True, "Discovering": False, "UUIDs": NO_UUIDS,
                }
            },
        }
        for path, dev in DEVICES.items():
            objects[dbus.ObjectPath(path)] = {"org.bluez.Device1": dev["props"]}
        return objects


class Adapter(dbus.service.Object):
    @dbus.service.method("org.bluez.Adapter1")
    def StartDiscovery(self):
        GLib.timeout_add(300, self.announce)

    @dbus.service.method("org.bluez.Adapter1")
    def StopDiscovery(self):
        pass

    @dbus.service.method("org.bluez.Adapter1", in_signature="a{sv}")
    def SetDiscoveryFilter(self, f):
        pass

    @dbus.service.method("org.bluez.Adapter1", in_signature="o")
    def RemoveDevice(self, path):
        log("RemoveDevice " + path)
        dev = DEVICES.pop(str(path), None)
        if dev is None:
            raise BluezError("DoesNotExist", "Does Not Exist")
        device_objects.pop(str(path)).remove_from_connection()
        root.InterfacesRemoved(dbus.ObjectPath(path), dbus.Array(DEVICE_IFACES, signature="s"))

    def announce(self):
        root.InterfacesAdded(dbus.ObjectPath(ADAPTER + "/dev_11_22_33_44_55_66"), {"org.bluez.Device1": {"Address": "11:22:33:44:55:66", "AddressType": "public", "Name": "Found", "Alias": "Found", "Paired": False, "Adapter": dbus.ObjectPath(ADAPTER), "UUIDs": NO_UUIDS}})
        self.PropertiesChanged("org.bluez.Adapter1", {"Discovering": True}, dbus.Array([], signature="s"))
        return False

    @dbus.service.signal("org.freedesktop.DBus.Properties", signature="sa{sv}as")
    def PropertiesChanged(self, iface, changed, invalidated):
        pass


class AgentManager(dbus.service.Object):
    @dbus.service.method("org.bluez.AgentManager1", in_signature="os", sender_keyword="sender")
    def RegisterAgent(self, path, capability, sender=None):
        if sender in AGENTS:
            raise BluezError("AlreadyExists", "Already Exists")
        AGENTS[sender] = str(path)
        log("RegisterAgent %s %s capability=%r" % (sender, path, str(capability)))

    @dbus.service.method("org.bluez.AgentManager1", in_signature="o", sender_keyword="sender")
    def RequestDefaultAgent(self, path, sender=None):
        if AGENTS.get(sender) != str(path):
            raise BluezError("DoesNotExist", "Does Not Exist")
        DEFAULT_AGENT[0] = (sender, str(path))
        log("RequestDefaultAgent %s %s" % (sender, path))

    @dbus.service.method("org.bluez.AgentManager1", in_signature="o", sender_keyword="sender")
    def UnregisterAgent(self, path, sender=None):
        if AGENTS.get(sender) != str(path):
            raise BluezError("DoesNotExist", "Does Not Exist")
        del AGENTS[sender]
        if DEFAULT_AGENT[0] == (sender, str(path)):
            DEFAULT_AGENT[0] = None
        log("UnregisterAgent %s %s" % (sender, path))


def pick_agent(sender):
    if sender in AGENTS:
        return (sender, AGENTS[sender])
    return DEFAULT_AGENT[0]


class Device(dbus.service.Object):
    def __init__(self, conn, path):
        super().__init__(conn, path)
        self.path = path

    @dbus.service.signal("org.freedesktop.DBus.Properties", signature="sa{sv}as")
    def PropertiesChanged(self, iface, changed, invalidated):
        pass

    @dbus.service.method("org.freedesktop.DBus.Properties", in_signature="ss", out_signature="v")
    def Get(self, iface, prop):
        return DEVICES[self.path]["props"][prop]

    @dbus.service.method("org.freedesktop.DBus.Properties", in_signature="s", out_signature="a{sv}")
    def GetAll(self, iface):
        return DEVICES[self.path]["props"]

    @dbus.service.method("org.freedesktop.DBus.Properties", in_signature="ssv")
    def Set(self, iface, prop, value):
        log("Set %s %s %r" % (self.path, prop, value))
        DEVICES[self.path]["props"][prop] = value

    def bonded(self, ok):
        props = DEVICES[self.path]["props"]
        props["Paired"] = True
        props["Bonded"] = True
        self.PropertiesChanged("org.bluez.Device1", {"Bonded": True, "Paired": True},
                               dbus.Array([], signature="s"))
        log("Pair %s -> success" % self.path)
        ok()

    @dbus.service.method("org.bluez.Device1", sender_keyword="sender",
                         async_callbacks=("ok", "err"))
    def Pair(self, sender=None, ok=None, err=None):
        dev = DEVICES[self.path]
        log("Pair %s from %s" % (self.path, sender))
        if dev["props"]["Paired"]:
            return err(BluezError("AlreadyExists", "Already Paired"))
        if dev["mode"] == "unreachable":
            return err(BluezError("ConnectionAttemptFailed", "Page Timeout"))
        if dev["mode"] == "justworks":
            return self.bonded(ok)
        agent = pick_agent(sender)
        if agent is None:
            log("Pair %s -> no agent" % self.path)
            return err(BluezError("AuthenticationFailed", "Authentication Failed"))
        owner, agent_path = agent

        def reply(pin):
            log("RequestPinCode reply %r" % str(pin))
            if str(pin) == PIN:
                self.bonded(ok)
            else:
                err(BluezError("AuthenticationFailed", "Authentication Failed"))

        def error(e):
            log("RequestPinCode error %s" % e.get_dbus_name())
            if e.get_dbus_name() == "org.freedesktop.DBus.Error.NoReply":
                # bluetoothd 5.82 sends Cancel expecting a reply (src/agent.c send_cancel_request).
                bus.call_async(owner, agent_path, "org.bluez.Agent1", "Cancel", "", [],
                               lambda *a: log("Cancel reply"),
                               lambda e: log("Cancel error %s" % e.get_dbus_name()))
            err(BluezError("AuthenticationFailed", "Authentication Failed"))

        log("RequestPinCode -> %s %s" % (owner, agent_path))
        bus.call_async(owner, agent_path, "org.bluez.Agent1", "RequestPinCode", "o",
                       [dbus.ObjectPath(self.path)], reply, error, timeout=AGENT_TIMEOUT_S)


root = Root(bus, "/")
Adapter(bus, ADAPTER)
AgentManager(bus, "/org/bluez")
device_objects = {path: Device(bus, path) for path in DEVICES}
print("fake bluez ready", flush=True)
GLib.MainLoop().run()
