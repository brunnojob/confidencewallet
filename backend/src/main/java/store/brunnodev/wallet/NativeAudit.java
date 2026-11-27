package store.brunnodev.wallet;
import java.lang.foreign.*;
import java.lang.invoke.MethodHandle;
import java.nio.charset.StandardCharsets;
public final class NativeAudit {
 private final MethodHandle hash,sign,verify;
 private final String key;
 public NativeAudit(String key) {
  if(key==null||!key.matches("[a-fA-F0-9]{64}"))throw new IllegalArgumentException("AUDIT_HMAC_KEY_HEX must be 32 random bytes in hex");
  this.key=key;
  System.load("/app/libledger_audit.so");
  var lookup=SymbolLookup.loaderLookup();
  var linker=Linker.nativeLinker();
  hash=linker.downcallHandle(lookup.find("audit_sha256_hex").orElseThrow(),FunctionDescriptor.of(ValueLayout.JAVA_INT,ValueLayout.ADDRESS,ValueLayout.ADDRESS));
  sign=linker.downcallHandle(lookup.find("audit_hmac_hex").orElseThrow(),FunctionDescriptor.of(ValueLayout.JAVA_INT,ValueLayout.ADDRESS,ValueLayout.ADDRESS,ValueLayout.ADDRESS));
  verify=linker.downcallHandle(lookup.find("audit_verify_hex").orElseThrow(),FunctionDescriptor.of(ValueLayout.JAVA_INT,ValueLayout.ADDRESS,ValueLayout.ADDRESS,ValueLayout.ADDRESS));
 }
 public String sha(String data){try(var a=Arena.ofConfined()){var out=a.allocate(65);if((int)hash.invokeExact(a.allocateUtf8String(data),out)!=0)throw new IllegalStateException("SHA failed");return out.getUtf8String(0);}catch(Throwable t){throw new IllegalStateException(t);}}
 public String sign(String data){try(var a=Arena.ofConfined()){var out=a.allocate(65);if((int)sign.invokeExact(a.allocateUtf8String(key),a.allocateUtf8String(data),out)!=0)throw new IllegalStateException("HMAC failed");return out.getUtf8String(0);}catch(Throwable t){throw new IllegalStateException(t);}}
 public boolean verify(String data,String signature){try(var a=Arena.ofConfined()){return (int)verify.invokeExact(a.allocateUtf8String(key),a.allocateUtf8String(data),a.allocateUtf8String(signature))==1;}catch(Throwable t){throw new IllegalStateException(t);}}
}
