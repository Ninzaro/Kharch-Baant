package com.kharchbaant.app;

import com.clerk.api.network.serialization.ClerkResult;
import java.util.List;

/**
 * Unwraps clerk-android {@link ClerkResult} in Java.
 *
 * Kotlin K2 ICEs on {@code is ClerkResult.Success<*, *>} / {@code when} over that
 * generic sealed interface, then reading {@code .value} (star-projected captured type).
 */
final class ClerkResults {
    private ClerkResults() {}

    static boolean isSuccess(ClerkResult<?, ?> result) {
        return result instanceof ClerkResult.Success;
    }

    static String failureDetail(ClerkResult<?, ?> result) {
        if (!(result instanceof ClerkResult.Failure)) {
            return "unknown Clerk failure";
        }
        ClerkResult.Failure<?> failure = (ClerkResult.Failure<?>) result;
        Throwable thrown = failure.getThrowable();
        Object error = failure.getError();
        Integer code = failure.getCode();
        StringBuilder detail = new StringBuilder();
        if (thrown != null && thrown.getMessage() != null) {
            detail.append(thrown.getClass().getSimpleName()).append(": ").append(thrown.getMessage());
        }
        if (error != null) {
            if (detail.length() > 0) {
                detail.append(" | ");
            }
            detail.append(error.toString());
        }
        if (code != null) {
            if (detail.length() > 0) {
                detail.append(" | ");
            }
            detail.append("code=").append(code);
        }
        return detail.length() > 0 ? detail.toString() : "ClerkResult.Failure";
    }

    static Throwable failureThrowable(ClerkResult<?, ?> result) {
        if (!(result instanceof ClerkResult.Failure)) {
            return null;
        }
        return ((ClerkResult.Failure<?>) result).getThrowable();
    }

    static String failureCode(ClerkResult<?, ?> result) {
        if (!(result instanceof ClerkResult.Failure)) {
            return "";
        }
        Object error = ((ClerkResult.Failure<?>) result).getError();
        Object errors = invokeNoArg(error, "getErrors");
        if (errors instanceof List && !((List<?>) errors).isEmpty()) {
            Object code = invokeNoArg(((List<?>) errors).get(0), "getCode");
            if (code instanceof String) {
                return (String) code;
            }
        }
        return "";
    }

    static boolean isAccountNotFound(String code) {
        return "external_account_not_found".equals(code)
                || "form_identifier_not_found".equals(code)
                || "identifier_not_found".equals(code);
    }

    static boolean isExternalAccountExists(String code) {
        return "external_account_exists".equals(code);
    }

    static String stringValue(ClerkResult<?, ?> result) {
        Object value = successValue(result);
        return value instanceof String ? (String) value : null;
    }

    static String sessionIdFromSuccess(ClerkResult<?, ?> result) {
        Object value = successValue(result);
        if (value == null) {
            return null;
        }
        String direct = createdSessionId(value);
        if (direct != null) {
            return direct;
        }
        String fromSignIn = createdSessionId(invokeNoArg(value, "getSignIn"));
        if (fromSignIn != null) {
            return fromSignIn;
        }
        return createdSessionId(invokeNoArg(value, "getSignUp"));
    }

    private static Object successValue(ClerkResult<?, ?> result) {
        if (!(result instanceof ClerkResult.Success)) {
            return null;
        }
        return ((ClerkResult.Success<?>) result).getValue();
    }

    private static String createdSessionId(Object target) {
        Object id = invokeNoArg(target, "getCreatedSessionId");
        return id instanceof String ? (String) id : null;
    }

    private static Object invokeNoArg(Object target, String methodName) {
        if (target == null) {
            return null;
        }
        try {
            return target.getClass().getMethod(methodName).invoke(target);
        } catch (Exception ignored) {
            return null;
        }
    }
}
