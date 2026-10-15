# Releasing

Every release is published in two places: on IPFS by its CID, and at
covenant.market. Both serve the identical build: the same commit always
builds the same CID. Releases are never
edited: a fix is a new release.

## 1. Settings

`covenant-frontend/.env.production` holds the release settings and is
committed, so anyone can rebuild the release from its commit. Everything in it
is public: it's baked into the site. Don't put API keys in it. The release
script refuses to run if a `.env.local` would override it.

## 2. Build, pack and pin

```bash
cd covenant-frontend
IPFS_API=http://127.0.0.1:5001 npm run release:ipfs     # with a local IPFS node running
```

This prints the CID, writes `release/covenant-<commit>.car`, and pins the
build on the local node. Then pin it on at least two independent pinning
services, for example with Kubo's remote pinning:

```bash
ipfs pin remote service add pinata   https://api.pinata.cloud/psa   <PINATA_JWT>
ipfs pin remote service add filebase https://api.filebase.io/v1/ipfs <FILEBASE_TOKEN>
ipfs pin remote add --service=pinata   --name=covenant-<commit> <CID>
ipfs pin remote add --service=filebase --name=covenant-<commit> <CID>
```

## 3. Publish the same build at covenant.market

covenant.market is served by Caddy on node1, from `/var/www/covenant`. On
node1 the repo is cloned at `/opt/covenant`. After pushing the release commit:

```bash
/opt/covenant/covenant-frontend/scripts/publish-site.sh /var/www/covenant
```

This pulls, builds and swaps the site in. The CID it prints must match the
one from step 2. Then, from any machine with this commit built:

```bash
npm run check-site -- https://covenant.market     # every file must match
```

## 4. Record and announce

- Add the release to [RELEASES.md](RELEASES.md): version, CID, commit, date.
- `git tag vX.Y.Z && git push --tags`.
- Announce the CID, commit and contract address together.
