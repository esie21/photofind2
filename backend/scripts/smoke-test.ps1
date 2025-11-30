# Smoke test for backend API endpoints
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File .\backend\scripts\smoke-test.ps1

$base = 'http://localhost:3001/api'

function Try-Invoke($scriptblock) {
    try {
        & $scriptblock
    } catch {
        Write-Host "ERROR: $($_.Exception.Message)"
    }
}

Write-Host '--- HEALTH ---'
Try-Invoke { Invoke-RestMethod -Method Get -Uri "$base/health" -ErrorAction Stop | ConvertTo-Json -Depth 5 }

Write-Host '\n--- SIGNUP ---'
$guid = ([guid]::NewGuid()).ToString()
$email = "test+$guid@example.com"
$signupBody = @{ email = $email; password = 'Password123!'; name = 'Smoke Test'; role = 'admin' } | ConvertTo-Json
Try-Invoke { Invoke-RestMethod -Method Post -Uri "$base/auth/signup" -ContentType 'application/json' -Body $signupBody -ErrorAction Stop | ConvertTo-Json -Depth 5 }

Write-Host '\n--- LOGIN ---'
$loginBody = @{ email = $email; password = 'Password123!' } | ConvertTo-Json
$token = $null
try {
    $login = Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType 'application/json' -Body $loginBody -ErrorAction Stop
    $login | ConvertTo-Json -Depth 5
    if ($login.token) { $token = $login.token }
} catch {
    Write-Host "login response/error: $($_.Exception.Message)"
}

if ($token) {
    Write-Host '\n--- GET /me ---'
    Try-Invoke { Invoke-RestMethod -Method Get -Uri "$base/auth/me" -Headers @{ Authorization = "Bearer $token" } -ErrorAction Stop | ConvertTo-Json -Depth 5 }
} else {
    Write-Host 'No token returned; skipping /me'
}

Write-Host '\n--- DONE ---'