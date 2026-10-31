# ltx-sandbox: TeX Live image for the IF-03 compile sandbox (FR-02.4, NFR-08)
# After the first pull, replace "latest" with the pinned digest, e.g.
#   FROM texlive/texlive@sha256:<digest>
FROM texlive/texlive@sha256:e8148b126545105c4aeeaa212f8a7bd02d05b500351372881055e1e59ae67d33

USER root

# pkill / ps are needed to stop TeX on timeout or cancel (FR-02.5, FR-02.6)
RUN apt-get update \
 && apt-get install -y --no-install-recommends procps \
 && rm -rf /var/lib/apt/lists/*

# Disable shell escape for every TeX run, not only via the -no-shell-escape flag
RUN echo "shell_escape = f" >> "$(kpsewhich texmf.cnf)" \
 && test "$(kpsewhich -var-value shell_escape)" = "f"

# Non-root user with a fixed uid so the container can run with --user 1000:1000
RUN (getent passwd 1000 >/dev/null || useradd -u 1000 -U -M -s /usr/sbin/nologin texuser)

# The container root is read-only at runtime, so every cache goes to /tmp (a tmpfs)
ENV HOME=/tmp \
    TEXMFVAR=/tmp/texmf-var \
    max_print_line=10000

USER 1000:1000
WORKDIR /work

# Warm container: kept alive, compiles run through "docker exec"
CMD ["sleep", "infinity"]
