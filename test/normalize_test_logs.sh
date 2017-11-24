#!/bin/bash
# -*- coding: utf-8, tab-width: 2 -*-


function normalize_test_logs () {
  export LANG{,UAGE}=en_US.UTF-8  # make error messages search engine-friendly
  local SELFPATH="$(readlink -m "$BASH_SOURCE"/..)"

  [ "$#" == 0 ] && tty --silent && echo "H: gonna read stdin. consider:" \
    "npm test |& ./test/normalize_test_logs.sh | tee test.log" >&2

  local MOD_DIR_RX="$(<<<"${SELFPATH%/*/*}" sed -re '
    s~[^A-Za-z0-9_/]~\\&~g')"

  sed -rf <(echo '
    s~^\r~~
    s~'"$MOD_DIR_RX"'/~/…/node_modules/~g
    s~(^ +[0-9]+ passing +\()[0-9]+(ms\))~\1###\2~
    ') -- "$@"
  return $?
}


normalize_test_logs "$@"; exit $?
