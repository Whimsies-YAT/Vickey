package org.whimsies.vickey.security

import android.content.Context
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.JSObject

@CapacitorPlugin(name = "EnvCheck")
class EnvCheckPlugin : Plugin() {

    private lateinit var envChecker: EnvironmentChecker

    override fun load() {
        envChecker = EnvironmentChecker(context)
    }

    @PluginMethod
    fun isRooted(call: PluginCall) {
        val result = JSObject()
        result.put("value", envChecker.isRooted())
        call.resolve(result)
    }
}

class EnvironmentChecker(private val context: Context) {

    fun isRooted(): Boolean {
        return checkSuBinary() || checkRootApps() || checkRWPaths() || checkBuildTags()
    }

    private fun checkSuBinary(): Boolean {
        val paths = arrayOf(
            "/system/app/Superuser.apk",
            "/sbin/su",
            "/system/bin/su",
            "/system/xbin/su",
            "/data/local/xbin/su",
            "/data/local/bin/su",
            "/system/sd/xbin/su",
            "/system/bin/failsafe/su",
            "/data/local/su",
            "/su/bin/su"
        )

        return paths.any { java.io.File(it).exists() }
    }

    private fun checkRootApps(): Boolean {
        val rootApps = arrayOf(
            "com.noshufou.android.su",
            "com.noshufou.android.su.elite",
            "eu.chainfire.supersu",
            "com.koushikdutta.superuser",
            "com.thirdparty.superuser",
            "com.yellowes.su",
            "com.topjohnwu.magisk"
        )

        val pm = context.packageManager
        return rootApps.any {
            try {
                pm.getPackageInfo(it, 0)
                true
            } catch (e: Exception) {
                false
            }
        }
    }

    private fun checkRWPaths(): Boolean {
        val paths = arrayOf("/system", "/system/bin", "/system/sbin", "/system/xbin", "/vendor/bin", "/sbin", "/etc")
        return paths.any { checkPathWritable(it) }
    }

    private fun checkPathWritable(path: String): Boolean {
        return try {
            val file = java.io.File(path)
            file.canWrite()
        } catch (e: Exception) {
            false
        }
    }

    private fun checkBuildTags(): Boolean {
        val buildTags = android.os.Build.TAGS
        return buildTags != null && buildTags.contains("test-keys")
    }
}
