#!/usr/bin/env sh
# Install Caddy's local root CA into the OS trust store.
set -eu

cert="${1:?usage: trust-caddy-ca.sh <root.crt>}"
if [ ! -f "$cert" ]; then
	echo "missing cert: $cert (is the studio running? try: make run)" >&2
	exit 1
fi

case "$(uname -s)" in
MINGW* | MSYS* | CYGWIN*)
	win_cert="$cert"
	if command -v cygpath >/dev/null 2>&1; then
		win_cert="$(cygpath -w "$cert")"
	fi
	certutil -addstore -user Root "$win_cert"
	;;
Darwin)
	keychain="$HOME/Library/Keychains/login.keychain-db"
	if [ ! -f "$keychain" ]; then
		keychain="$HOME/Library/Keychains/login.keychain"
	fi
	security add-trusted-cert -d -r trustRoot -k "$keychain" "$cert"
	;;
Linux)
	if command -v update-ca-certificates >/dev/null 2>&1; then
		sudo cp "$cert" /usr/local/share/ca-certificates/book-creator-caddy.crt
		sudo update-ca-certificates
	elif command -v trust >/dev/null 2>&1; then
		sudo trust anchor --store "$cert"
	else
		echo "Unsupported Linux CA tooling; install manually: $cert" >&2
		exit 1
	fi
	;;
*)
	echo "Unsupported OS; install manually: $cert" >&2
	exit 1
	;;
esac

echo "Installed Caddy local root CA from $cert"
echo "Restart the browser if https://books.localhost:17443 still shows Not secure."
