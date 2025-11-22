package org.whimsies.vickey.security

import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import com.getcapacitor.JSObject
import java.io.IOException
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLPeerUnverifiedException

@CapacitorPlugin(name = "SecureHttp")
class SecureHttpPlugin : Plugin() {

    private lateinit var secureClient: OkHttpClient
    private lateinit var envChecker: EnvironmentChecker

    override fun load() {
        // TODO: Configure certificate pins (use `openssl s_client ... | openssl x509 ... | openssl dgst -sha256 -binary | openssl enc -base64`)
        val certificatePinner = CertificatePinner.Builder()
            .build()

        secureClient = OkHttpClient.Builder()
            .certificatePinner(certificatePinner)
            .addInterceptor(SecurityInterceptor())
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .build()

        envChecker = EnvironmentChecker(context)
    }

    @PluginMethod
    fun fetch(call: PluginCall) {
        val url = call.getString("url")
        if (url == null) {
            call.reject("URL is required")
            return
        }

        val method = call.getString("method", "GET")
        val headersData = call.getObject("headers")
        val bodyString = call.getString("body")

        try {
            val requestBuilder = Request.Builder().url(url)

            if (headersData != null) {
                val keys = headersData.keys()
                while (keys.hasNext()) {
                    val key = keys.next()
                    val value = headersData.getString(key)
                    if (value != null) {
                        requestBuilder.addHeader(key, value)
                    }
                }
            }

            val methodNonNull = method ?: "GET"
            if (bodyString != null && methodNonNull in listOf("POST", "PUT", "PATCH")) {
                val contentType = headersData?.optString("Content-Type", "application/json")
                    ?: "application/json"
                val requestBody = bodyString.toRequestBody(contentType.toMediaType())
                requestBuilder.method(methodNonNull, requestBody)
            } else {
                requestBuilder.method(methodNonNull, null)
            }

            val request = requestBuilder.build()

            val response = secureClient.newCall(request).execute()

            val result = JSObject()
            result.put("status", response.code)
            result.put("body", response.body?.string() ?: "")

            call.resolve(result)

        } catch (e: SSLPeerUnverifiedException) {
            call.reject("SSL_PINNING_FAILED", "Certificate validation failed. Possible man-in-the-middle attack.", e)
        } catch (e: IOException) {
            call.reject("NETWORK_ERROR", e.message, e)
        } catch (e: Exception) {
            call.reject("UNKNOWN_ERROR", e.message, e)
        }
    }

    private inner class SecurityInterceptor : Interceptor {
        override fun intercept(chain: Interceptor.Chain): Response {
            if (envChecker.isRooted()) {
                android.util.Log.w("SecureHttp", "Warning: Device is rooted")
            }

            if (envChecker.isXposedActive()) {
                throw IOException("Unsafe environment: Xposed framework detected")
            }

            if (envChecker.isFridaRunning()) {
                throw IOException("Unsafe environment: Frida detected")
            }

            return chain.proceed(chain.request())
        }
    }
}
