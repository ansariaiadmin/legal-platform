# TLS certificates

Place the certificate chain and private key for your domain here, for example
`fullchain.pem` and `privkey.pem`, and reference them from a TLS server block in
`infra/nginx/nginx.conf`. This directory is mounted read-only into the proxy
container at `/etc/nginx/certs`.

Certificate and key files are ignored by Git. Never commit a private key.

See `docs/SECURITY-HARDENING.md` for the full HTTPS setup.
