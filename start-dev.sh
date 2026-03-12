#!/bin/bash
export PATH="/Users/kevinmeyers/.nvm/versions/node/v24.14.0/bin:$PATH"
cd "/Users/kevinmeyers/Desktop/STuff for Claude/Photo App/lucy-prints"
exec npx next dev -p ${PORT:-3000}
