package org.whimsies.vickey

import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.JSObject

@CapacitorPlugin(name = "ServerConfig")
class ServerConfigPlugin : Plugin() {

    @PluginMethod
    fun getServerUrl(call: PluginCall) {
        val prefs = context.getSharedPreferences("vickey_prefs", android.content.Context.MODE_PRIVATE)
        val serverUrl = prefs.getString("serverUrl", null)

        val result = JSObject()
        result.put("url", serverUrl)
        call.resolve(result)
    }
}
