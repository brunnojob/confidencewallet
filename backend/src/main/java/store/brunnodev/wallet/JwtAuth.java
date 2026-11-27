package store.brunnodev.wallet;
import com.nimbusds.jose.*;
import com.nimbusds.jose.jwk.source.RemoteJWKSet;

import com.nimbusds.jose.proc.*;
import com.nimbusds.jwt.*;
import java.net.URL;
import java.time.Instant;
import java.util.*;
public final class JwtAuth {
 private final DefaultJWTProcessor<SecurityContext> processor=new DefaultJWTProcessor<>();
 private final String issuer;
 public JwtAuth(String supabaseUrl) throws Exception{
  issuer=supabaseUrl.replaceAll("/+$","")+"/auth/v1";
  var source=new RemoteJWKSet<SecurityContext>(new URL(issuer+"/.well-known/jwks.json"));
  processor.setJWSKeySelector((header,context)->{
   if(!Set.of(JWSAlgorithm.RS256,JWSAlgorithm.ES256).contains(header.getAlgorithm()))throw new KeySourceException("Unsupported JWT algorithm");
   return new JWSVerificationKeySelector<SecurityContext>(header.getAlgorithm(),source).selectJWSKeys(header,context);
  });
 }
 public UUID authenticate(String authorization) throws Exception{
  if(authorization==null||!authorization.startsWith("Bearer "))throw new SecurityException("Missing bearer token");
  var claims=processor.process(authorization.substring(7),null);
  Date now=Date.from(Instant.now());
  if(!issuer.equals(claims.getIssuer())||claims.getExpirationTime()==null||!claims.getExpirationTime().after(now)||claims.getNotBeforeTime()!=null&&claims.getNotBeforeTime().after(now)||!claims.getAudience().contains("authenticated")||!"authenticated".equals(claims.getStringClaim("role")))throw new SecurityException("Invalid token claims");
  return UUID.fromString(claims.getSubject());
 }
}
