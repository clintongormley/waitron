# CI only, never installed on a box: a stand-in for BlueZ on the image-smoke runner's system bus,
# which has no Bluetooth hardware. One powered adapter and one paired printer, and a scan that finds a
# second device and reports a changed property — enough for `bluetoothctl list`, `devices` and
# `scan`. Run as root with the bluez package installed, which is how it came to own `org.bluez` on the
# runner.
import dbus
import dbus.mainloop.glib
import dbus.service
from gi.repository import GLib

dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
bus = dbus.SystemBus()
name = dbus.service.BusName("org.bluez", bus)
ADAPTER = "/org/bluez/hci0"
DEVICE = ADAPTER + "/dev_66_55_44_33_22_11"
NO_UUIDS = dbus.Array([], signature="s")


class Root(dbus.service.Object):
    @dbus.service.signal("org.freedesktop.DBus.ObjectManager", signature="oa{sa{sv}}")
    def InterfacesAdded(self, path, interfaces):
        pass

    @dbus.service.method("org.freedesktop.DBus.ObjectManager", out_signature="a{oa{sa{sv}}}")
    def GetManagedObjects(self):
        return {
            dbus.ObjectPath("/org/bluez"): {"org.bluez.AgentManager1": {}},
            dbus.ObjectPath(ADAPTER): {
                "org.bluez.Adapter1": {
                    "Address": "00:11:22:33:44:55", "AddressType": "public", "Name": "waitron-ci",
                    "Alias": "waitron-ci", "Class": dbus.UInt32(0), "Powered": True,
                    "Discoverable": False, "Pairable": True, "Discovering": False, "UUIDs": NO_UUIDS,
                }
            },
            dbus.ObjectPath(DEVICE): {
                "org.bluez.Device1": {
                    "Address": "66:55:44:33:22:11", "AddressType": "public", "Name": "CI Printer",
                    "Alias": "CI Printer", "Paired": True, "Bonded": True, "Trusted": False,
                    "Connected": False, "Adapter": dbus.ObjectPath(ADAPTER), "UUIDs": NO_UUIDS,
                }
            },
        }


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

    def announce(self):
        root.InterfacesAdded(dbus.ObjectPath(ADAPTER + "/dev_11_22_33_44_55_66"), {"org.bluez.Device1": {"Address": "11:22:33:44:55:66", "AddressType": "public", "Name": "Found", "Alias": "Found", "Paired": False, "Adapter": dbus.ObjectPath(ADAPTER), "UUIDs": NO_UUIDS}})
        self.PropertiesChanged("org.bluez.Adapter1", {"Discovering": True}, dbus.Array([], signature="s"))
        return False

    @dbus.service.signal("org.freedesktop.DBus.Properties", signature="sa{sv}as")
    def PropertiesChanged(self, iface, changed, invalidated):
        pass


class AgentManager(dbus.service.Object):
    @dbus.service.method("org.bluez.AgentManager1", in_signature="os")
    def RegisterAgent(self, path, capability):
        pass

    @dbus.service.method("org.bluez.AgentManager1", in_signature="o")
    def RequestDefaultAgent(self, path):
        pass

    @dbus.service.method("org.bluez.AgentManager1", in_signature="o")
    def UnregisterAgent(self, path):
        pass


root = Root(bus, "/")
Adapter(bus, ADAPTER)
AgentManager(bus, "/org/bluez")
print("fake bluez ready", flush=True)
GLib.MainLoop().run()
