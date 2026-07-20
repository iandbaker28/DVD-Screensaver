// Runtime-configurable API base URL.
//
// Edit this file (or bind-mount a replacement over it) to point the
// frontend at wherever the `api` conversion service actually lives —
// e.g. behind a reverse-proxied domain. Left blank, it falls back to
// same-hostname on the api's compose port, which works out of the box
// for `docker compose up` on a single host.
window.DVD_CONFIG = {
  apiBaseUrl: `${window.location.protocol}//${window.location.hostname}:8384`,
};
