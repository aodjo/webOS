# Alpine Linux root file system for the Linux app (v86, 32-bit x86, booted over 9p).
FROM docker.io/i386/alpine:3.21.0

ENV KERNEL=virt
ENV ADDPKGS="bash python3 vim nano git curl htop fastfetch less"

RUN apk add openrc alpine-base agetty alpine-conf linux-$KERNEL linux-firmware-none $ADDPKGS

# tty1 (the VGA console the app shows) and ttyS0 (the hidden serial line the app drives) log in as root.
RUN sed -i 's/getty 38400 tty1/agetty --autologin root --noclear tty1 linux/' /etc/inittab
RUN echo 'ttyS0::respawn:/sbin/agetty --autologin root -s ttyS0 115200 vt100' >> /etc/inittab
RUN echo "root:" | chpasswd
RUN sed -i 's#/bin/sh$#/bin/bash#' /etc/passwd

RUN setup-hostname webos

COPY motd /etc/motd
RUN echo 'export PS1="\[\e[1;32m\]\u@webos\[\e[0m\]:\[\e[1;34m\]\w\[\e[0m\]# "' > /root/.bashrc && echo '[ -f ~/.bashrc ] && . ~/.bashrc' > /root/.bash_profile

# https://wiki.alpinelinux.org/wiki/Alpine_Linux_in_a_chroot#Preparing_init_services
RUN for i in devfs dmesg mdev hwdrivers; do rc-update add $i sysinit; done
RUN for i in hwclock modules sysctl hostname syslog bootmisc; do rc-update add $i boot; done
RUN rc-update add killprocs shutdown

# Initramfs with the 9p modules, so the kernel can mount the root file system from the browser.
RUN mkinitfs -F "base virtio 9p" $(cat /usr/share/kernel/$KERNEL/kernel.release)
