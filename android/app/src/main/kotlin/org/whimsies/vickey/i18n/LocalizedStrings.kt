package org.whimsies.vickey.i18n

import android.content.Context
import android.util.Log
import org.json.JSONObject
import java.util.Locale

object LocalizedStrings {
    private const val TAG = "LocalizedStrings"
    private const val ASSET_PREFIX = "i18n"
    private const val FALLBACK_LOCALE = "en-US"

    @Volatile
    private var appContext: Context? = null
    private val bundles: MutableMap<String, Map<String, String>> = mutableMapOf()

    fun init(context: Context) {
        if (appContext == null) {
            synchronized(this) {
                if (appContext == null) {
                    appContext = context.applicationContext
                }
            }
        }
    }

    fun text(key: String, fallback: String): String {
        val value = getString(key)
        return value ?: fallback
    }

    private fun getString(key: String): String? {
        val context = appContext ?: return null
        for (tag in candidateLocaleTags()) {
            val bundle = ensureBundle(context, tag)
            bundle[key]?.let { return it }
        }
        return null
    }

    private fun ensureBundle(context: Context, tag: String): Map<String, String> {
        bundles[tag]?.let { return it }

        val bundle = loadBundle(context, tag)
        bundles[tag] = bundle
        return bundle
    }

    private fun loadBundle(context: Context, tag: String): Map<String, String> {
        return try {
            context.assets.open("$ASSET_PREFIX/$tag.json").use { inputStream ->
                val json = inputStream.bufferedReader().use { it.readText() }
                val obj = JSONObject(json)
                val result = mutableMapOf<String, String>()
                val keys = obj.keys()
                while (keys.hasNext()) {
                    val entryKey = keys.next()
                    result[entryKey] = obj.optString(entryKey)
                }
                result
            }
        } catch (e: Exception) {
            Log.w(TAG, "Missing or invalid bundle for $tag: ${e.message}")
            emptyMap()
        }
    }

    private fun candidateLocaleTags(): List<String> {
        val locale = Locale.getDefault()
        val tags = linkedSetOf<String>()

        val primaryTag = locale.toLanguageTag()
        if (primaryTag.isNotBlank()) {
            tags.add(primaryTag)
        }

        val language = locale.language
        if (language.isNotBlank()) {
            tags.add(language)
        }

        tags.add(FALLBACK_LOCALE)
        return tags.toList()
    }
}
