# The print agent — one bundled file on node 24. Build from the workspace root:
#   pnpm --filter @waitron/print-agent-app build
#   docker build -t waitron-print-agent apps/print-agent
#
# Run — the device access each transport needs (verified against the real box 2026-09-10,
# task-6-hardware-facts.md; the container runs as the unprivileged `node` user):
#   docker run -d --name print-agent -v waitron-print-agent:/var/lib/waitron-print-agent \
#     --network host \                      # mDNS printer discovery answers on the LAN, not a NAT bridge
#     --device /dev/usb/lp0 \               # the usblp write node (or --device /dev/bus/usb for hotplug)
#     --group-add 7 \                       # /dev/usb/lp0 is crw-rw---- root:lp; gid 7 (lp) grants write
#     -v /run/dbus/system_bus_socket:/run/dbus/system_bus_socket \  # BlueZ over DBus for Bluetooth pair
#     -e WAITRON_SERVER_URL=https://box.example waitron-print-agent
# With --network host the setup page binds 9110 on the host directly (no -p needed).
FROM node:24-alpine
ENV NODE_ENV=production WAITRON_STATE_DIR=/var/lib/waitron-print-agent WAITRON_SETUP_PORT=9110
RUN mkdir -p /var/lib/waitron-print-agent && chown node:node /var/lib/waitron-print-agent
COPY dist/print-agent.js /app/print-agent.js
USER node
VOLUME ["/var/lib/waitron-print-agent"]
EXPOSE 9110
CMD ["node", "/app/print-agent.js"]
