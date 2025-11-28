package org.whimsies.vickey.security

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.JSObject

@CapacitorPlugin(name = "SecureStorage")
class SecureStoragePlugin : Plugin() {

    private lateinit var encryptedPrefs: SharedPreferences

    override fun load() {
        try {
            val masterKey = MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()

            encryptedPrefs = EncryptedSharedPreferences.create(
                context,
                "vickey_secure_storage",
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
        } catch (e: Exception) {
            android.util.Log.e("SecureStorage", "Failed to initialize encrypted storage", e)
            throw e
        }
    }

    @PluginMethod
    fun set(call: PluginCall) {
        val key = call.getString("key")
        val value = call.getString("value")

        if (key == null || value == null) {
            call.reject("Key and value are required")
            return
        }

        try {
            encryptedPrefs.edit().putString(key, value).apply()
            call.resolve()
        } catch (e: Exception) {
            call.reject("Failed to store value", e)
        }
    }

    @PluginMethod
    fun get(call: PluginCall) {
        val key = call.getString("key")

        if (key == null) {
            call.reject("Key is required")
            return
        }

        try {
            val value = encryptedPrefs.getString(key, null)
            val result = JSObject()
            result.put("value", value)
            call.resolve(result)
        } catch (e: Exception) {
            call.reject("Failed to retrieve value", e)
        }
    }

    @PluginMethod
    fun remove(call: PluginCall) {
        val key = call.getString("key")

        if (key == null) {
            call.reject("Key is required")
            return
        }

        try {
            encryptedPrefs.edit().remove(key).apply()
            call.resolve()
        } catch (e: Exception) {
            call.reject("Failed to remove value", e)
        }
    }

    @PluginMethod
    fun clear(call: PluginCall) {
        try {
            encryptedPrefs.edit().clear().apply()
            call.resolve()
        } catch (e: Exception) {
            call.reject("Failed to clear storage", e)
        }
    }
}
