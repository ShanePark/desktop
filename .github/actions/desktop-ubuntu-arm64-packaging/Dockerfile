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

# ARM64 cross-compilation dependencies
RUN apt-get install -y gcc-aarch64-linux-gnu g++-aarch64-linux-gnu binutils-aarch64-linux-gnu

ENV AS=aarch64-linux-gnu-as
ENV STRIP=aarch64-linux-gnu-strip
ENV AR=aarch64-linux-gnu-ar
ENV CC=aarch64-linux-gnu-gcc
ENV CPP=aarch64-linux-gnu-cpp
ENV CXX=aarch64-linux-gnu-g++
ENV LD=aarch64-linux-gnu-ld
ENV FC=aarch64-linux-gnu-gfortran
ENV PKG_CONFIG_PATH=/usr/lib/aarch64-linux-gnu/pkgconfig
ENV npm_config_arch=arm64
ENV SHELL=/bin/bash

# Node runs on the x64 GitHub runner; the application target is cross-compiled
# for ARM64 through the toolchain above.
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
