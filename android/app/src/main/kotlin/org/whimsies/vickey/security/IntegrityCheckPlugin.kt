package org.whimsies.vickey.security

import android.content.pm.PackageManager
import android.content.pm.Signature
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.JSObject
import java.security.MessageDigest

@CapacitorPlugin(name = "IntegrityCheck")
class IntegrityCheckPlugin : Plugin() {

    // TODO: Replace with your release certificate SHA-256 fingerprint (keytool -list -v -keystore <path> -alias <alias>)
    private val EXPECTED_SIGNATURE_SHA256 = "YOUR_RELEASE_CERT_SHA256_HERE"

    @PluginMethod
    fun verifySignature(call: PluginCall) {
        try {
            val packageInfo = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
                context.packageManager.getPackageInfo(
                    context.packageName,
                    PackageManager.GET_SIGNING_CERTIFICATES
                )
            } else {
                @Suppress("DEPRECATION")
                context.packageManager.getPackageInfo(
                    context.packageName,
                    PackageManager.GET_SIGNATURES
                )
            }

            val signatures = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
                packageInfo.signingInfo?.apkContentsSigners ?: arrayOf()
            } else {
                @Suppress("DEPRECATION")
                packageInfo.signatures ?: arrayOf()
            }

            if (signatures.isEmpty()) {
                val result = JSObject()
                result.put("valid", false)
                call.resolve(result)
                return
            }

            if ((context.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
                val result = JSObject()
                result.put("valid", true)
                call.resolve(result)
                return
            }

            val currentSignature = sha256(signatures[0])
            val isValid = currentSignature == EXPECTED_SIGNATURE_SHA256 ||
                          EXPECTED_SIGNATURE_SHA256 == "YOUR_RELEASE_CERT_SHA256_HERE"

            val result = JSObject()
            result.put("valid", isValid)
            call.resolve(result)

        } catch (e: Exception) {
            call.reject("Failed to verify signature", e)
        }
    }

    @PluginMethod
    fun getCertificateFingerprint(call: PluginCall) {
        try {
            val packageInfo = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
                context.packageManager.getPackageInfo(
                    context.packageName,
                    PackageManager.GET_SIGNING_CERTIFICATES
                )
            } else {
                @Suppress("DEPRECATION")
                context.packageManager.getPackageInfo(
                    context.packageName,
                    PackageManager.GET_SIGNATURES
                )
            }

            val signatures = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
                packageInfo.signingInfo?.apkContentsSigners ?: arrayOf()
            } else {
                @Suppress("DEPRECATION")
                packageInfo.signatures ?: arrayOf()
            }

            if (signatures.isEmpty()) {
                call.reject("No signatures found")
                return
            }

            val fingerprint = sha256(signatures[0])

            val result = JSObject()
            result.put("fingerprint", fingerprint)
            call.resolve(result)

        } catch (e: Exception) {
            call.reject("Failed to get certificate fingerprint", e)
        }
    }

    private fun sha256(signature: Signature): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val hash = digest.digest(signature.toByteArray())
        return hash.joinToString("") { "%02x".format(it) }
    }
}
