package com.kharchbaant.app

import android.util.Log
import com.clerk.api.Clerk
import com.clerk.api.auth.types.IdTokenProvider
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout

/**
 * Native Google ID token → clerk-android session → short-lived session JWT.
 *
 * ClerkResult is unwrapped in [ClerkResults] (Java). Do not use
 * `is ClerkResult.Success<*, *>` or `when (result)` on ClerkResult here —
 * those patterns trigger a Kotlin K2 internal compiler error.
 */
@CapacitorPlugin(name = "ClerkNativeAuth")
class ClerkNativeAuthPlugin : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    @PluginMethod
    fun signInWithGoogle(call: PluginCall) {
        val googleIdToken = call.getString("googleIdToken").orEmpty().trim()
        if (googleIdToken.isEmpty()) {
            call.reject("Missing Google ID token.")
            return
        }

        val publishableKey = call.getString("publishableKey").orEmpty().trim()

        scope.launch {
            try {
                Log.i(TAG, "Native Google authentication succeeded")
                ensureClerkReady(publishableKey)
                authenticateNativeClerk(googleIdToken)
                Log.i(TAG, "Native Clerk authentication succeeded")

                val jwt = ClerkResults.stringValue(Clerk.auth.getToken())
                if (jwt.isNullOrBlank()) {
                    call.reject("Failed to obtain native Clerk session token.")
                    return@launch
                }
                Log.i(TAG, "Native session token obtained")
                val ret = JSObject()
                ret.put("token", jwt)
                call.resolve(ret)
            } catch (e: Exception) {
                Log.e(TAG, "Native Clerk authentication failed: ${e.javaClass.simpleName}")
                call.reject("Native Clerk authentication failed.")
            }
        }
    }

    private suspend fun ensureClerkReady(publishableKeyFromJs: String) {
        val currentActivity = activity
        if (currentActivity != null) {
            Clerk.attachActivity(currentActivity)
        }

        if (!Clerk.isInitialized.value) {
            val key = if (publishableKeyFromJs.startsWith("pk_")) {
                publishableKeyFromJs
            } else {
                currentActivity?.getString(R.string.clerk_publishable_key).orEmpty().trim()
            }
            if (!key.startsWith("pk_")) {
                throw IllegalStateException("Missing Clerk publishable key for native initialization.")
            }
            val context = currentActivity ?: bridge.context
            Clerk.initialize(context, key)
            if (currentActivity != null) {
                Clerk.attachActivity(currentActivity)
            }
        }

        withTimeout(20_000) {
            Clerk.isInitialized.first { initialized -> initialized }
        }
    }

    private suspend fun authenticateNativeClerk(googleIdToken: String) {
        val signInResult = Clerk.auth.signInWithIdToken {
            token = googleIdToken
            provider = IdTokenProvider.GOOGLE
        }

        val sessionId = if (ClerkResults.isSuccess(signInResult)) {
            ClerkResults.sessionIdFromSuccess(signInResult)
        } else {
            val signUpResult = Clerk.auth.signUpWithIdToken(googleIdToken, IdTokenProvider.GOOGLE)
            if (!ClerkResults.isSuccess(signUpResult)) {
                throw IllegalStateException("Native Clerk authentication failed.")
            }
            ClerkResults.sessionIdFromSuccess(signUpResult)
        }

        if (!sessionId.isNullOrBlank()) {
            Clerk.auth.setActive(sessionId = sessionId)
        }

        if (Clerk.activeSession == null) {
            throw IllegalStateException("Native Clerk authentication did not produce an active session.")
        }
    }

    companion object {
        private const val TAG = "ClerkNativeAuth"
    }
}
