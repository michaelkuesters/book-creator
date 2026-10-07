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
	# Current user store (no elevation).
	certutil -addstore -f -user Root "$win_cert"
	# Local machine store — Chrome picks this up more reliably; UAC prompt.
	powershell.exe -NoProfile -Command \
		"Start-Process -FilePath certutil.exe -ArgumentList @('-addstore','-f','Root','$win_cert') -Verb RunAs -Wait" \
		|| echo "Local Machine install skipped or cancelled; Current User store still has the CA."
	if tasklist 2>/dev/null | grep -qi '[Cc]hrome.exe'; then
		echo ""
		echo "Chrome is still running. It will keep showing Not secure until you fully quit it:"
		echo "  Chrome menu → Exit   (or chrome://restart)"
		echo "Then open exactly: https://books.localhost:17443"
		echo "(not https://127.0.0.1:17443 — the cert is only valid for books.localhost)"
	fi
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

echo ""
echo "Installed Caddy local root CA from $cert"
echo "Fully quit and reopen the browser, then open https://books.localhost:17443"
