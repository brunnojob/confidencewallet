CC ?= gcc
CFLAGS = -std=c17 -O3 -Wall -Wextra -Werror -fPIC
all: libledger_audit.so ledger-audit
libledger_audit.so: ledger_audit.c ledger_audit.h
	$(CC) $(CFLAGS) -shared -o $@ ledger_audit.c
ledger-audit: ledger_audit.c cli.c ledger_audit.h
	$(CC) $(CFLAGS) -o $@ ledger_audit.c cli.c
test: all
	@test "$$(./ledger-audit sha256 abc)" = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
	@test "$$(./ledger-audit hmac 0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b 'Hi There')" = "198a607eb44bfbc69903a0f1cf2bbdc5ba0aa3f3d9ae3c1c7a3b1696a0b68cf7"
clean:
	rm -f libledger_audit.so ledger-audit
