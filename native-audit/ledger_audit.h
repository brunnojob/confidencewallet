#ifndef LEDGER_AUDIT_H
#define LEDGER_AUDIT_H
#include <stddef.h>
int audit_sha256_hex(const char *message, char out[65]);
int audit_hmac_hex(const char *key_hex, const char *message, char out[65]);
int audit_verify_hex(const char *key_hex, const char *message, const char *expected);
#endif
