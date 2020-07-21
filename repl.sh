#/usr/bin/env bash

if command -v yarn &> /dev/null
then yarn build
else npm run build
fi

INIT_SCRIPT=$(cat <<"JS"
    const { MerossHTTPClient, MerossManager } = require('./dist/index')
    console.log('import { MerossHTTPClient, MerossManager } from "meross"')
    process.stdout.write('> ')
JS
)

node --experimental-repl-await -i -e "$INIT_SCRIPT"