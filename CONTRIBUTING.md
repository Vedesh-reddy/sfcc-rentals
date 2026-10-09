# Contributing

Start from `main` and create a focused `feature/`, `fix/`, or `docs/` branch. Keep behavior changes and documentation accurate together.

```sh
npm ci
npm run validate
npm run package:metadata
```

CI mocks cannot check real concurrency, basket quotas, option pricing, tax, remote includes, Business Manager permissions, multipart uploads or metadata installation. For a platform behavior change, exercise the affected feature on a sandbox, following the sandbox checks in [docs/TESTING.md](docs/TESTING.md). In the PR, say which checks were automated and which were manual.

Preserve these rules:

- a unit's day is claimed only by creating its `RentalUnitDay` key; never update another booking's row to take it over;
- a booking's days are created in one transaction, so a failed claim leaves nothing behind;
- a basket line is never added and removed in the same request; claim before the base route runs;
- every storefront post and desk action validates CSRF, and every amount and date is validated on the server;
- uploaded files get server-generated names and only image types are stored;
- custom object iterators are closed in `finally`.

Keep credentials and generated output out of Git. Add new attributes to both the metadata and the installation guide, and new text to `rentals.properties`.

See [NOTICE.md](NOTICE.md) for attribution and terms.
