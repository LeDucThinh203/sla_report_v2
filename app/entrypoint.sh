#!/bin/sh
set -e
case "$1" in
  start) exec node dist/src/server.js ;;
  test)  exec node --test dist/tests/*.test.js ;;
  *)     exec "$@" ;;
esac
