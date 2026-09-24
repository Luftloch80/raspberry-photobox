#!/bin/bash -e
# Photobox ins Image installieren (läuft auf dem Build-Host, ROOTFS_DIR = künftiges System)

APP="${ROOTFS_DIR}/opt/photobox"
install -d "${APP}"
cp -a files/photobox/. "${APP}/"

install -m 755 files/photobox-boot.sh      "${ROOTFS_DIR}/usr/local/sbin/photobox-boot"
install -m 755 files/photobox/deploy/photobox-wifi "${ROOTFS_DIR}/usr/local/sbin/photobox-wifi"
for unit in photobox-hostapd.service photobox-dhcp.service photobox-wifi-auto.service; do
	install -m 644 "files/photobox/deploy/${unit}" "${ROOTFS_DIR}/etc/systemd/system/${unit}"
done
echo "${FIRST_USER_NAME} ALL=(root) NOPASSWD: /usr/local/sbin/photobox-wifi" > "${ROOTFS_DIR}/etc/sudoers.d/photobox-wifi"
chmod 440 "${ROOTFS_DIR}/etc/sudoers.d/photobox-wifi"
install -m 644 files/photobox-boot.service "${ROOTFS_DIR}/etc/systemd/system/photobox-boot.service"
install -m 644 files/photobox-cups.service "${ROOTFS_DIR}/etc/systemd/system/photobox-cups.service"
sed "s/__USER__/${FIRST_USER_NAME}/g" files/photobox.service > "${ROOTFS_DIR}/etc/systemd/system/photobox.service"

install -m 644 files/Caddyfile "${ROOTFS_DIR}/etc/caddy/Caddyfile"
install -d "${ROOTFS_DIR}/etc/systemd/system/caddy.service.d"
install -m 644 files/caddy-photobox.conf "${ROOTFS_DIR}/etc/systemd/system/caddy.service.d/photobox.conf"

# Einstellungsdatei auf der Boot-Partition (am PC direkt auf der SD-Karte änderbar)
install -m 644 files/photobox.txt "${ROOTFS_DIR}/boot/firmware/photobox.txt"
install -m 644 files/photobox.txt "${APP}/photobox.txt.default"

on_chroot << CHROOT
chown -R ${FIRST_USER_NAME}:${FIRST_USER_NAME} /opt/photobox
usermod -aG lpadmin ${FIRST_USER_NAME}
systemctl enable photobox-boot.service photobox.service photobox-cups.service photobox-wifi-auto.service
systemctl disable hostapd.service || true
systemctl mask hostapd.service || true
systemctl enable caddy.service cups.service avahi-daemon.service NetworkManager.service
CHROOT
