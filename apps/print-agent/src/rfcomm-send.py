"""Sends standard input to a paired Bluetooth printer's serial port over RFCOMM.

Usage: rfcomm-send.py ADDRESS CHANNEL TIMEOUT_SECONDS

Node has no Bluetooth sockets, so the print agent runs this for every Bluetooth job. It exits 0 once
every byte has been handed to the kernel, and 1 with the error on standard error otherwise.
"""

import socket
import sys


def main() -> int:
    address, channel, timeout = sys.argv[1], int(sys.argv[2]), float(sys.argv[3])
    data = sys.stdin.buffer.read()
    try:
        with socket.socket(socket.AF_BLUETOOTH, socket.SOCK_STREAM, socket.BTPROTO_RFCOMM) as sock:
            sock.settimeout(timeout)
            sock.connect((address, channel))
            sock.sendall(data)
    except OSError as error:
        print(f"rfcomm {address} channel {channel}: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
