FROM ubuntu:22.04

COPY entrypoint.sh /entrypoint.sh

ARG DEBIAN_FRONTEND=noninteractive
ARG NODE_VERSION=24.15.0
ARG NODE_SHA256=472655581fb851559730c48763e0c9d3bc25975c59d518003fc0849d3e4ba0f6

# baseline dependencies for all versions
RUN apt update && apt install -y software-properties-common lsb-release \
    sudo wget curl build-essential jq autoconf automake \
    pkg-config ca-certificates rpm xz-utils

# Docker does not provide PAM's login PATH. Supply the standard Ubuntu path
# for the login shells used by the shell-environment test.
RUN printf '%s\n' \
      'export PATH="${PATH:-/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin}"' \
      > /etc/profile.d/desktop-ci-path.sh

# add electron unit test dependencies
RUN apt install -y libasound2 libatk-bridge2.0-0 libatk1.0-0 \
    libatspi2.0-0 libc6 libcairo2 libcups2 libdbus-1-3 libdrm2 \
    libexpat1 libgbm1 libgcc1 libglib2.0-0 libgtk-3-0 libnspr4 \
    libnss3 libpango-1.0-0 libx11-6 libxcb1 libxcomposite1 \
    libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2 \
    libsecret-1-0

ENV AS=as
ENV STRIP=strip
ENV AR=ar
ENV CC=gcc
ENV CPP=cpp
ENV CXX=g++
ENV LD=ld
ENV FC=gfortran
ENV PKG_CONFIG_PATH=/usr/lib/x86_64-linux-gnu/pkgconfig
ENV npm_config_arch=x64
ENV SHELL=/bin/bash

# Node 24 is required by the current process-proxy dependency. Ubuntu 22.04
# provides the glibc required by the bundled Git binary.
RUN curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
      -o /tmp/node.tar.xz \
    && echo "${NODE_SHA256}  /tmp/node.tar.xz" | sha256sum -c - \
    && tar -xJf /tmp/node.tar.xz --strip-components=1 -C /usr/local/ \
    && rm /tmp/node.tar.xz \
    && npm install --global yarn

# install new enough git to work with repository
RUN add-apt-repository ppa:git-core/ppa -y \
    && apt update \
    && apt install -y git \
    && git --version

ENTRYPOINT ["/entrypoint.sh"]
