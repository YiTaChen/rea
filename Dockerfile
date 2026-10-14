# Official Rust distribution, content-pinned from registry-1.docker.io/library/rust.
FROM rust:1.92.0-slim-bookworm@sha256:f1f73538ebe623fd3673a35aff3df358ae1084c64c55646516e5b17b321b6c9b AS rust-toolchain
FROM ubuntu:24.04

ARG BINWALK_INSTALL_DIR="/tmp/binwalk"
ARG DEFAULT_WORKING_DIR="/analysis"

WORKDIR /tmp

# Update apt
RUN apt-get update && apt-get upgrade -y && apt-get install --no-install-recommends -y python3

# Copy over the Binwalk build directory
RUN mkdir -p ${BINWALK_INSTALL_DIR}
COPY . ${BINWALK_INSTALL_DIR}

# Allow pip to install packages system-wide
RUN mkdir -p $HOME/.config/pip && echo "[global]" > $HOME/.config/pip/pip.conf && echo "break-system-packages = true" >> $HOME/.config/pip/pip.conf

# Supply reviewed offline artifacts, hashes and wheels in the build context (see dependencies/README.md).
ENV BINWALK_ARTIFACT_DIR="${BINWALK_INSTALL_DIR}/dependencies/offline/artifacts" \
    BINWALK_ARTIFACT_SHA256_FILE="${BINWALK_INSTALL_DIR}/dependencies/offline/SHA256SUMS" \
    BINWALK_WHEELHOUSE="${BINWALK_INSTALL_DIR}/dependencies/offline/wheels" \
    BINWALK_PIP_REQUIREMENTS="${BINWALK_INSTALL_DIR}/dependencies/offline/requirements.txt"

# Install all system dependencies
RUN ${BINWALK_INSTALL_DIR}/dependencies/ubuntu.sh

# Copy the verified Rust toolchain; Ubuntu's compiler can lag the locked dependency graph.
COPY --from=rust-toolchain /usr/local/rustup /usr/local/rustup
COPY --from=rust-toolchain /usr/local/cargo /usr/local/cargo
ENV RUSTUP_HOME=/usr/local/rustup CARGO_HOME=/usr/local/cargo PATH=/usr/local/cargo/bin:$PATH

# Build and install Binwalk
RUN cd ${BINWALK_INSTALL_DIR} && cargo build --locked --release && cp ./target/release/binwalk /usr/local/bin/binwalk

# Clean up binwalk build directory
RUN rm -rf ${BINWALK_INSTALL_DIR}

# Create the working directory
RUN mkdir -p ${DEFAULT_WORKING_DIR} && chmod 777 ${DEFAULT_WORKING_DIR}
WORKDIR ${DEFAULT_WORKING_DIR}

# Run as the default ubuntu user
USER ubuntu

# Enable this environment variable to remove extractor top-level symlink,
# as the symlink target path in the docker environment will not match that of the host.
ENV BINWALK_RM_EXTRACTION_SYMLINK=1

ENTRYPOINT [ "binwalk" ]
