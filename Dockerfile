FROM python:3.14-slim-bookworm

RUN mkdir -p /data/input /data/output
RUN useradd -m unblob
RUN chown -R unblob /data

WORKDIR /data/output

# Enable backports, required to get upx package
RUN printf "deb http://deb.debian.org/debian bookworm-backports main\n" \
    > /etc/apt/sources.list.d/backports.list

# Supply reviewed extractor artifacts and independently trusted SHA256SUMS.
# Missing inputs intentionally stop the build before any extractor is installed.
COPY extractor-artifacts/ /extractor-artifacts/
ENV UNBLOB_ARTIFACT_DIR=/extractor-artifacts \
    UNBLOB_ARTIFACT_SHA256_FILE=/extractor-artifacts/SHA256SUMS
COPY install-deps.sh /
RUN sh /install-deps.sh && rm -rf /extractor-artifacts

# Build the project wheel with the audited frozen uv lock, then prepare a reviewed
# platform-specific complete hash lock/wheelhouse. Never resolve floating PyPI dependencies.
COPY python-wheelhouse/ /python-wheelhouse/
COPY dist/*.whl /python-wheelhouse/
COPY pyproject.toml /tmp/pyproject.toml
COPY scripts/validate-wheelhouse.py /tmp/validate-wheelhouse.py
RUN python /tmp/validate-wheelhouse.py /python-wheelhouse/requirements.txt /python-wheelhouse /tmp/pyproject.toml \
    && pip --isolated install --no-index --find-links /python-wheelhouse --only-binary :all: \
       --require-hashes --disable-pip-version-check -r /python-wheelhouse/requirements.txt --prefix /usr/local \
    && rm -rf /python-wheelhouse /tmp/validate-wheelhouse.py /tmp/pyproject.toml

USER unblob
ENTRYPOINT ["unblob"]
