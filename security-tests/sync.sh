#!/bin/bash
# Copies the app's and the namespace's source into fe/ and ns/ so the tests
# exercise the exact code that ships (imports patched for Node's TS loader).
set -e
cd "$(dirname "$0")"
rm -rf fe ns && mkdir -p fe ns
cp ../covenant-frontend/src/*.ts ../covenant-frontend/src/*.tsx fe/
cp -r ../aon-namespace-evm-spot/src/. ns/
echo '{"type":"module"}' > fe/package.json; echo '{"type":"module"}' > ns/package.json
find fe ns -name '*.ts' -o -name '*.tsx' | xargs sed -i -E 's#(from +"\.{1,2}/[^".]+)"#\1.ts"#g'
