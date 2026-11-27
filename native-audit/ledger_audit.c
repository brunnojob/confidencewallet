#include "ledger_audit.h"
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
static const uint32_t k[64]={
0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2};
static uint32_t rot(uint32_t x,unsigned n){return (x>>n)|(x<<(32-n));}
typedef struct {uint32_t h[8];uint8_t buf[64];uint64_t len;size_t used;} ctx;
static void init(ctx *c){const uint32_t h[]={0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19};memcpy(c->h,h,sizeof h);c->len=0;c->used=0;}
static void block(ctx *c,const uint8_t *p){
uint32_t w[64];for(size_t i=0;i<16;i++)w[i]=((uint32_t)p[i*4]<<24)|((uint32_t)p[i*4+1]<<16)|((uint32_t)p[i*4+2]<<8)|p[i*4+3];
for(size_t i=16;i<64;i++){uint32_t a=w[i-15],b=w[i-2];w[i]=(rot(b,17)^rot(b,19)^(b>>10))+w[i-7]+(rot(a,7)^rot(a,18)^(a>>3))+w[i-16];}
uint32_t a=c->h[0],b=c->h[1],d=c->h[3],e=c->h[4],f=c->h[5],g=c->h[6],h=c->h[7],z=c->h[2];
for(size_t i=0;i<64;i++){uint32_t s1=rot(e,6)^rot(e,11)^rot(e,25),ch=(e&f)^(~e&g),t1=h+s1+ch+k[i]+w[i],s0=rot(a,2)^rot(a,13)^rot(a,22),maj=(a&b)^(a&z)^(b&z),t2=s0+maj;h=g;g=f;f=e;e=d+t1;d=z;z=b;b=a;a=t1+t2;}
c->h[0]+=a;c->h[1]+=b;c->h[2]+=z;c->h[3]+=d;c->h[4]+=e;c->h[5]+=f;c->h[6]+=g;c->h[7]+=h;}
static void update(ctx *c,const uint8_t *p,size_t n){c->len+=(uint64_t)n*8;while(n){size_t m=64-c->used;if(m>n)m=n;memcpy(c->buf+c->used,p,m);c->used+=m;p+=m;n-=m;if(c->used==64){block(c,c->buf);c->used=0;}}}
static void finish(ctx *c,uint8_t out[32]){uint64_t bits=c->len;c->buf[c->used++]=0x80;if(c->used>56){memset(c->buf+c->used,0,64-c->used);block(c,c->buf);c->used=0;}memset(c->buf+c->used,0,56-c->used);for(size_t i=0;i<8;i++)c->buf[56+i]=(uint8_t)(bits>>(56-8*i));block(c,c->buf);for(size_t i=0;i<8;i++)for(size_t j=0;j<4;j++)out[i*4+j]=(uint8_t)(c->h[i]>>(24-8*j));memset(c,0,sizeof *c);}
static void hex(const uint8_t *p,size_t n,char *out){static const char digits[]="0123456789abcdef";for(size_t i=0;i<n;i++){out[2*i]=digits[p[i]>>4];out[2*i+1]=digits[p[i]&15];}out[2*n]=0;}
static int decode(const char *s,uint8_t *out,size_t n){if(strlen(s)!=2*n)return -1;for(size_t i=0;i<n;i++){char a=s[2*i],b=s[2*i+1];int x=(a>='0'&&a<='9')?a-'0':(a>='a'&&a<='f')?a-'a'+10:(a>='A'&&a<='F')?a-'A'+10:-1;int y=(b>='0'&&b<='9')?b-'0':(b>='a'&&b<='f')?b-'a'+10:(b>='A'&&b<='F')?b-'A'+10:-1;if(x<0||y<0)return -1;out[i]=(uint8_t)(x*16+y);}return 0;}
int audit_sha256_hex(const char *message,char out[65]){if(!message||!out)return -1;ctx c;uint8_t digest[32];init(&c);update(&c,(const uint8_t *)message,strlen(message));finish(&c,digest);hex(digest,32,out);return 0;}
int audit_hmac_hex(const char *key_hex,const char *message,char out[65]){if(!key_hex||!message||!out)return -1;uint8_t key[32],inner[32],pad[64];if(decode(key_hex,key,32))return -1;memset(pad,0x36,sizeof pad);for(size_t i=0;i<32;i++)pad[i]^=key[i];ctx c;init(&c);update(&c,pad,64);update(&c,(const uint8_t *)message,strlen(message));finish(&c,inner);memset(pad,0x5c,sizeof pad);for(size_t i=0;i<32;i++)pad[i]^=key[i];init(&c);update(&c,pad,64);update(&c,inner,32);finish(&c,inner);hex(inner,32,out);memset(key,0,sizeof key);memset(pad,0,sizeof pad);memset(inner,0,sizeof inner);return 0;}
int audit_verify_hex(const char *key_hex,const char *message,const char *expected){char got[65];uint8_t target[32],actual[32];if(!expected||decode(expected,target,32)||audit_hmac_hex(key_hex,message,got)||decode(got,actual,32))return -1;unsigned diff=0;for(size_t i=0;i<32;i++)diff|=(unsigned)(target[i]^actual[i]);return diff==0?1:0;}
