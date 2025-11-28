-keep class com.getcapacitor.** { *; }
-keepclassmembers class com.getcapacitor.** { *; }

-keep class org.whimsies.vickey.security.** { *; }
-keepclassmembers class org.whimsies.vickey.security.** { *; }

-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keep @com.getcapacitor.PluginMethod public class * { *; }

-dontwarn okhttp3.**
-dontwarn okio.**
-keep class okhttp3.** { *; }
-keep interface okhttp3.** { *; }

-keepattributes Signature
-keepattributes *Annotation*
-keep class com.google.gson.** { *; }
-keep class * implements com.google.gson.TypeAdapterFactory
-keep class * implements com.google.gson.JsonSerializer
-keep class * implements com.google.gson.JsonDeserializer

-keep class androidx.security.crypto.** { *; }

-keepattributes SourceFile,LineNumberTable

-renamesourcefileattribute SourceFile
