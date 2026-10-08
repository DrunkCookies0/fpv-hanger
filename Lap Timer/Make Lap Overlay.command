#!/bin/zsh
# Double-click to build a lap-timer overlay for Premiere Pro.
cd "${0:A:h}"
if [[ ! -x ./laptimer || laptimer.swift -nt laptimer ]]; then
  echo "Setting up the lap timer (first run only)…"
  swiftc -O laptimer.swift -o laptimer || { echo "Could not build laptimer."; read -k1 "?Press any key to close."; exit 1 }
fi
./laptimer
echo
read -k1 "?Press any key to close."
