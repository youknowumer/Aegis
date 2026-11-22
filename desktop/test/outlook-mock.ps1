# Test harness: runs ../outlook.ps1 against a pretend Outlook (no Outlook needed). Reads the request JSON on stdin.
# Output: the script's JSON, then a newline, then what the pretend Outlook saw.
param([string]$Script)
$ErrorActionPreference = 'Stop'
$global:Log = New-Object System.Collections.ArrayList

function New-Draft([string]$to, [string]$subject, [string]$html) {
    $d = [pscustomobject]@{ To = $to; CC = ''; Subject = $subject; HTMLBody = $html; GetInspector = $true }
    Add-Member -InputObject $d -MemberType ScriptProperty -Name Recipients -Value {
        $arr = @()
        foreach ($a in ([string]$this.To -split ';')) { if ($a.Trim()) { $arr += [pscustomobject]@{ Name = $a.Trim(); Resolved = ($a -notmatch 'unresolved') } } }
        $arr = Add-Member -InputObject $arr -MemberType ScriptMethod -Name ResolveAll -Value { $true } -PassThru
        , $arr
    }
    foreach ($n in 'Save', 'Display', 'Send') {
        $name = $n
        Add-Member -InputObject $d -MemberType ScriptMethod -Name $n -Value ([scriptblock]::Create("[void]`$global:Log.Add(@{ call = '$name'; to = `$this.To; cc = `$this.CC; subject = `$this.Subject; html = `$this.HTMLBody })"))
    }
    return $d
}

function New-Mail([string]$id, [string]$name, [string]$addr, [string]$subject, [datetime]$when, [bool]$unread, [string]$body, [int]$class = 43) {
    $m = [pscustomobject]@{ Class = $class; EntryID = $id; SenderName = $name; SenderEmailType = 'SMTP'; SenderEmailAddress = $addr; Subject = $subject
        ReceivedTime = $when; UnRead = $unread; Body = $body; Attachments = @([pscustomobject]@{ FileName = 'q4.xlsx' }); To = 'me@example.com'; CC = '' }
    $m | Add-Member -MemberType ScriptMethod -Name Reply -Value { New-Draft $this.SenderEmailAddress ('RE: ' + $this.Subject) '<html><body>quoted original</body></html>' }
    $m | Add-Member -MemberType ScriptMethod -Name ReplyAll -Value { New-Draft ($this.SenderEmailAddress + '; me@example.com') ('RE: ' + $this.Subject) '<html><body>quoted original</body></html>' }
    return $m
}

$now = Get-Date
$today = $now.Date
$mails = @(
    (New-Mail 'ID0001' 'Ali Raza' 'ali@example.com' 'Budget approval' $today.AddHours(9) $true "Please approve   the Q4`r`nbudget by Monday.")
    (New-Mail 'ID0002' 'HR' 'hr@example.com' '' $today.AddHours(8) $false '')
    (New-Mail 'ID0003' 'Meeting' 'cal@example.com' 'Invite' $today.AddHours(7) $false 'meeting request' 53)
    (New-Mail 'ID0004' 'Old' 'old@example.com' 'Yesterday news' $today.AddHours(-3) $true 'old')
)
# Outlook reorders the collection when Sort() is called; the pretend one is already in the order Sort('[ReceivedTime]', $true) gives
$inboxItems = @($mails | Sort-Object ReceivedTime -Descending)
$inboxItems = Add-Member -InputObject $inboxItems -MemberType ScriptMethod -Name Sort -Value { param($field, $desc) [void]$global:Log.Add(@{ call = 'Sort'; field = $field; desc = [bool]$desc }) } -PassThru
$inbox = [pscustomobject]@{ Items = $inboxItems }
Add-Member -InputObject $inbox -MemberType ScriptMethod -Name Display -Value { [void]$global:Log.Add(@{ call = 'DisplayInbox' }) }
$ns = [pscustomobject]@{}
Add-Member -InputObject $ns -MemberType ScriptMethod -Name GetDefaultFolder -Value { param($n) $inbox }
Add-Member -InputObject $ns -MemberType ScriptMethod -Name GetItemFromID -Value { param($id) $mails | Where-Object { $_.EntryID -eq $id } | Select-Object -First 1 }
$ol = [pscustomobject]@{}
Add-Member -InputObject $ol -MemberType ScriptMethod -Name GetNamespace -Value { param($n) $ns }
Add-Member -InputObject $ol -MemberType ScriptMethod -Name CreateItem -Value { param($n) New-Draft '' '' '<html><body>-- signature --</body></html>' }

function New-Object {
    param([Parameter(Position = 0)][string]$TypeName, [Parameter(Position = 1)]$ArgumentList, [string]$ComObject)
    if ($ComObject) { return $ol }
    Microsoft.PowerShell.Utility\New-Object -TypeName $TypeName -ArgumentList $ArgumentList
}

& $Script
[Console]::Out.WriteLine('')
[Console]::Out.WriteLine(($global:Log | ConvertTo-Json -Depth 5 -Compress))
