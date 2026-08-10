# External Caddy sites

Production mounts a root-owned directory from `CADDY_SITES_DIRECTORY` here.
Only `*.caddy` files are imported. This tracked directory keeps disposable and
CI Compose runs self-contained without adding a production-only virtual host.
