FROM debian:trixie-slim
RUN set -eu; \
    printf '%s\n' 'Acquire::Retries "3";' 'Acquire::http::Timeout "30";' 'Acquire::https::Timeout "30";' 'APT::Update::Error-Mode "any";' > /etc/apt/apt.conf.d/99bounded-waits; \
    bounded() { for attempt in 1 2 3; do timeout 300 "$@" && return 0; done; return 1; }; \
    bounded apt-get update; \
    bounded apt-get install -y --no-install-recommends wireguard-tools iproute2 iptables jq socat util-linux; \
    mkdir -p /app/third-party/system /keys /control; \
    chmod 700 /keys; \
    chown 10001:0 /control; chmod 770 /control; \
    cp -a /usr/share/doc /app/third-party/system/; \
    cp -a /usr/share/common-licenses /app/third-party/system/; \
    dpkg-query -W > /app/third-party/system/PACKAGES.txt; \
    rm -rf /var/lib/apt/lists/* /etc/apt/apt.conf.d/99bounded-waits
COPY deploy/tunnel/peer.sh /app/peer.sh
ENTRYPOINT ["sh", "/app/peer.sh"]
