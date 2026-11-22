# Aegis <-> desktop Outlook bridge (classic Outlook, through COM).
# Input : one JSON object on stdin (UTF-8).   Output: one JSON object on stdout (UTF-8).
# Nothing from the request is ever pasted into a command: it is only read as data.
$ErrorActionPreference = 'Stop'

function Out-Json($obj) {
    $json = $obj | ConvertTo-Json -Depth 6 -Compress
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $stream = [Console]::OpenStandardOutput()
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush()
}

function Squash([string]$text, [int]$max) {
    if (-not $text) { return '' }
    $t = ($text -replace '\s+', ' ').Trim()
    if ($t.Length -gt $max) { return $t.Substring(0, $max) + '...' }
    return $t
}

function Sender-Address($mail) {
    try {
        if ($mail.SenderEmailType -eq 'EX') {
            $u = $mail.Sender.GetExchangeUser()
            if ($u -and $u.PrimarySmtpAddress) { return [string]$u.PrimarySmtpAddress }
        }
    } catch { }
    return [string]$mail.SenderEmailAddress
}

function Html-Text([string]$text) {
    $enc = [System.Net.WebUtility]::HtmlEncode($text)
    $enc = $enc -replace "`r`n", '<br>' -replace "`n", '<br>' -replace "`r", '<br>'
    return '<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt">' + $enc + '</div><br>'
}

function Build-Mail($ol, $ns, $req) {
    if ($req.reply_to) {
        $orig = $ns.GetItemFromID([string]$req.reply_to)
        if ($req.reply_all) { $m = $orig.ReplyAll() } else { $m = $orig.Reply() }
    } else {
        $m = $ol.CreateItem(0)
        $null = $m.GetInspector   # loads the user's default signature into the new message
    }
    if ($req.to) { $m.To = [string]$req.to }
    if ($req.cc) { $m.CC = [string]$req.cc }
    if ($req.subject) { $m.Subject = [string]$req.subject }
    $m.HTMLBody = (Html-Text ([string]$req.body)) + $m.HTMLBody
    if ($m.Recipients.Count -gt 0) {
        $null = $m.Recipients.ResolveAll()
        $bad = @()
        foreach ($r in $m.Recipients) { if (-not $r.Resolved) { $bad += [string]$r.Name } }
        if ($bad.Count -gt 0) { throw ('Outlook could not resolve these recipients: ' + ($bad -join ', ')) }
    } else {
        throw 'The email has no recipient.'
    }
    return $m
}

try {
    $reader = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), [System.Text.Encoding]::UTF8)
    $req = $reader.ReadToEnd() | ConvertFrom-Json

    try { $ol = [System.Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application') }
    catch { $ol = New-Object -ComObject Outlook.Application }
    $ns = $ol.GetNamespace('MAPI')

    switch ($req.action) {
        'today' {
            $inbox = $ns.GetDefaultFolder(6)
            if ($req.show) { try { $inbox.Display() } catch { } }
            $days = [Math]::Max(1, [Math]::Min(14, [int]$req.days))
            $limit = [Math]::Max(1, [Math]::Min(40, [int]$req.limit))
            $start = (Get-Date).Date.AddDays(1 - $days)
            $items = $inbox.Items
            $items.Sort('[ReceivedTime]', $true)
            $list = @()
            $total = 0
            $unread = 0
            foreach ($m in $items) {
                if ($m.Class -ne 43) { continue }
                if ($m.ReceivedTime -lt $start) { break }
                $total++
                if ($m.UnRead) { $unread++ }
                if ($req.unread_only -and -not $m.UnRead) { continue }
                if ($list.Count -ge $limit) { continue }
                $list += [pscustomobject]@{
                    id          = [string]$m.EntryID
                    from        = [string]$m.SenderName
                    from_email  = (Sender-Address $m)
                    subject     = [string]$m.Subject
                    received    = $m.ReceivedTime.ToString('yyyy-MM-dd HH:mm')
                    unread      = [bool]$m.UnRead
                    attachments = [int]$m.Attachments.Count
                    preview     = (Squash $m.Body 400)
                }
            }
            Out-Json @{ ok = $true; total = $total; unread = $unread; since = $start.ToString('yyyy-MM-dd HH:mm'); items = $list }
        }
        'read' {
            $m = $ns.GetItemFromID([string]$req.id)
            $names = @()
            foreach ($a in $m.Attachments) { $names += [string]$a.FileName }
            $body = [string]$m.Body
            if ($body.Length -gt 8000) { $body = $body.Substring(0, 8000) + "`n...(cut)" }
            Out-Json @{
                ok = $true; from = [string]$m.SenderName; from_email = (Sender-Address $m)
                to = [string]$m.To; cc = [string]$m.CC; subject = [string]$m.Subject
                received = $m.ReceivedTime.ToString('yyyy-MM-dd HH:mm'); attachments = $names; body = $body
            }
        }
        'draft' {
            $m = Build-Mail $ol $ns $req
            $m.Save()
            $m.Display()
            Out-Json @{ ok = $true; message = 'Draft saved in Outlook and opened for review. Nothing was sent.' }
        }
        'send' {
            $m = Build-Mail $ol $ns $req
            $to = [string]$m.To
            $m.Send()
            Out-Json @{ ok = $true; message = ('Email sent to ' + $to + '.') }
        }
        default { throw ('unknown action: ' + $req.action) }
    }
}
catch {
    Out-Json @{ ok = $false; error = [string]$_.Exception.Message }
}
