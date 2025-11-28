package org.whimsies.vickey

import android.content.Intent
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import org.whimsies.vickey.i18n.LocalizedStrings
import java.net.URL

class ServerSetupActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        LocalizedStrings.init(applicationContext)

        fun tr(key: String, fallback: String): String = LocalizedStrings.text(key, fallback)

        val layout = android.widget.LinearLayout(this).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            setPadding(64, 64, 64, 64)
        }

        val title = android.widget.TextView(this).apply {
            text = tr("mobile.serverSetup.title", "Welcome to Vickey")
            textSize = 24f
            setPadding(0, 0, 0, 32)
        }
        layout.addView(title)

        val description = android.widget.TextView(this).apply {
            text = tr("mobile.serverSetup.description", "Enter your Misskey server URL to get started")
            setPadding(0, 0, 0, 24)
        }
        layout.addView(description)

        val urlInput = EditText(this).apply {
            hint = tr("mobile.serverSetup.placeholder", "https://your-server.example")
            inputType = android.text.InputType.TYPE_TEXT_VARIATION_URI
            setPadding(16, 16, 16, 16)
        }
        layout.addView(urlInput)

        val connectButton = Button(this).apply {
            text = tr("mobile.serverSetup.connect", "Connect")
            setPadding(0, 32, 0, 0)
            setOnClickListener {
                val urlText = urlInput.text.toString().trim()

                if (validateUrl(urlText)) {
                    saveServerUrl(urlText)
                    startMainActivity()
                } else {
                    Toast.makeText(
                        this@ServerSetupActivity,
                        tr("mobile.serverSetup.invalidUrl", "Please enter a valid URL (e.g., https://misskey.io)"),
                        Toast.LENGTH_LONG
                    ).show()
                }
            }
        }
        layout.addView(connectButton)

        setContentView(layout)
    }

    private fun validateUrl(urlText: String): Boolean {
        if (urlText.isEmpty()) return false

        return try {
            val url = URL(urlText)
            url.protocol == "https" || url.protocol == "http"
        } catch (e: Exception) {
            false
        }
    }

    private fun saveServerUrl(url: String) {
        val prefs = getSharedPreferences("vickey_prefs", MODE_PRIVATE)
        prefs.edit().putString("serverUrl", url).apply()
    }

    private fun startMainActivity() {
        val intent = Intent(this, MainActivity::class.java)
        intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
        startActivity(intent)
        finish()
    }
}
