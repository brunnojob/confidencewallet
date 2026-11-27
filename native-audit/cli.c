#include "ledger_audit.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(int argc,char **argv){char out[65];if(argc==3&&strcmp(argv[1],"sha256")==0){if(audit_sha256_hex(argv[2],out))return 2;puts(out);return 0;}if(argc==4&&strcmp(argv[1],"hmac")==0){if(audit_hmac_hex(argv[2],argv[3],out))return 2;puts(out);return 0;}if(argc==5&&strcmp(argv[1],"verify")==0){int r=audit_verify_hex(argv[2],argv[3],argv[4]);puts(r==1?"OK":"FAIL");return r==1?0:1;}fputs("usage: ledger-audit sha256 MESSAGE | hmac KEY_HEX MESSAGE | verify KEY_HEX MESSAGE EXPECTED_HEX\n",stderr);return 2;}
