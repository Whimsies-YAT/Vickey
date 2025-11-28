package org.whimsies.vickey

import android.app.AlertDialog
import android.content.Intent
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updateLayoutParams
import com.getcapacitor.BridgeActivity
import com.getcapacitor.BridgeWebViewClient
import org.whimsies.vickey.BuildConfig
import org.whimsies.vickey.i18n.LocalizedStrings
import org.whimsies.vickey.security.EnvironmentChecker
import java.io.ByteArrayInputStream

class MainActivity : BridgeActivity() {
    private var serverUrl: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        val prefs = getSharedPreferences("vickey_prefs", MODE_PRIVATE)
        serverUrl = prefs.getString("serverUrl", null)

        if (serverUrl == null) {
            val intent = Intent(this, ServerSetupActivity::class.java)
            startActivity(intent)
            finish()
            return
        }

        super.onCreate(savedInstanceState)
        LocalizedStrings.init(applicationContext)

        WindowCompat.setDecorFitsSystemWindows(window, false)

        ViewCompat.setOnApplyWindowInsetsListener(bridge.webView) { view, insets ->
            val systemBars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or
                WindowInsetsCompat.Type.displayCutout()
            )

            view.updateLayoutParams<ViewGroup.MarginLayoutParams> {
                topMargin = systemBars.top
                bottomMargin = systemBars.bottom
                leftMargin = systemBars.left
                rightMargin = systemBars.right
            }

            android.util.Log.d("MainActivity", "Applied WebView margins: top=${systemBars.top}, bottom=${systemBars.bottom}")

            insets
        }

        ViewCompat.requestApplyInsets(bridge.webView)

        injectServerUrlEarly(serverUrl!!)

        val injectingClient = InjectingBridgeWebViewClient(serverUrl!!)
        bridge.webViewClient = injectingClient
        bridge.webView.webViewClient = injectingClient

        registerPlugin(ServerConfigPlugin::class.java)
        if (BuildConfig.ENABLE_SECURE_HTTP_PLUGIN) {
            registerPlugin(org.whimsies.vickey.security.SecureHttpPlugin::class.java)
        } else {
            android.util.Log.i("MainActivity", "SecureHttp plugin disabled via BuildConfig")
        }
        registerPlugin(org.whimsies.vickey.security.SecureStoragePlugin::class.java)
        registerPlugin(org.whimsies.vickey.security.EnvCheckPlugin::class.java)
        registerPlugin(org.whimsies.vickey.security.IntegrityCheckPlugin::class.java)

        checkRootAndWarn()
    }

    private fun checkRootAndWarn() {
        val envChecker = EnvironmentChecker(this)
        if (envChecker.isRooted()) {
            AlertDialog.Builder(this)
                .setTitle(tr("mobile.rootWarning.title", "Root Detected"))
                .setMessage(tr("mobile.rootWarning.message", "Your device has been rooted."))
                .setPositiveButton(tr("mobile.rootWarning.proceed", "I Understand, Continue")) { dialog, _ ->
                    dialog.dismiss()
                }
                .setCancelable(true)
                .show()
        }
    }

    private fun tr(key: String, fallback: String): String {
        return LocalizedStrings.text(key, fallback)
    }

    private fun injectServerUrlEarly(url: String) {
        bridge.webView.addJavascriptInterface(object {
            @JavascriptInterface
            fun getServerUrl(): String {
                return url
            }
        }, "AndroidBridge")

        android.util.Log.d("MainActivity", "Registered AndroidBridge with server URL: $url")
    }

    private inner class InjectingBridgeWebViewClient(
        private val configuredServerUrl: String
    ) : BridgeWebViewClient(bridge) {
        override fun shouldInterceptRequest(
            view: WebView,
            request: WebResourceRequest
        ): WebResourceResponse? {
            val requestUri = request.url
            val url = requestUri.toString()
            val path = requestUri.path ?: ""
            val isLocalhost = requestUri.host.equals("localhost", ignoreCase = true)
            val targetsIndex = path.endsWith("/index.html") || path.endsWith("index.html")
            val targetsRoot = path.isEmpty() || path == "/"

            android.util.Log.d("MainActivity", "Inspecting WebView request: $url")

            if (isLocalhost && (targetsIndex || targetsRoot)) {
                try {
                    val inputStream = assets.open("public/index.html")
                    var html = inputStream.bufferedReader().use { it.readText() }

                    html = html.replace("__SERVER_URL_PLACEHOLDER__", configuredServerUrl)

                    val earlyScript = """
                        <script>
                        (function() {
                            const meta = document.querySelector('meta[property="instance_url"]');
                            if (meta && meta.content === '__SERVER_URL_PLACEHOLDER__') {
                                meta.content = '$configuredServerUrl';
                            }
                            console.log('[Android] Early injection: Server URL set to $configuredServerUrl');
                        })();
                        </script>
                    """.trimIndent()

                    html = html.replace("<head>", "<head>\n$earlyScript")

                    android.util.Log.d("MainActivity", "Injecting server URL into index.html for $url")
                    return WebResourceResponse(
                        "text/html",
                        "UTF-8",
                        ByteArrayInputStream(html.toByteArray())
                    )
                } catch (e: Exception) {
                    android.util.Log.e("MainActivity", "Failed to inject server URL", e)
                }
            }

            return super.shouldInterceptRequest(view, request)
        }

        override fun onPageFinished(view: WebView?, url: String?) {
            super.onPageFinished(view, url)
        }
    }
}
