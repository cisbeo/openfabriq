# The relay without Cloudflare: the same Worker and Durable Object, run by workerd, the
# open-source runtime of Cloudflare Workers, on a machine of your own. `pnpm bundle` writes
# dist/index.js first. Run it with: ENGINE_TOKEN=... workerd serve workerd.capnp
# --socket-addr http=<ip:port> and --directory-path data=<dir> change the defaults below.
using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [
    (name = "relay", worker = .relay),
    # The Durable Object's SQLite files: keep this folder, it holds the queue and the secrets.
    (name = "data", disk = (path = "data", writable = true)),
  ],
  sockets = [
    # Plain HTTP: put HTTPS in front (Caddy in docker-compose.yml). The proxy's
    # X-Forwarded-Proto makes request.url https, so the Linear callback address is right.
    (name = "http", address = "*:8080", service = "relay",
     http = (forwardedProtoHeader = "X-Forwarded-Proto")),
  ],
);

const relay :Workerd.Worker = (
  modules = [(name = "index.js", esModule = embed "dist/index.js")],
  compatibilityDate = "2026-10-01",
  bindings = [
    (name = "ENGINE_TOKEN", fromEnvironment = "ENGINE_TOKEN"),
    (name = "RELAY", durableObjectNamespace = "Relay"),
  ],
  durableObjectNamespaces = [(className = "Relay", uniqueKey = "openfabriq-relay", enableSql = true)],
  durableObjectStorage = (localDisk = "data"),
);
