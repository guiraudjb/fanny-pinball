' ---------------------------------------------------------------- règles : TROIS PALETTES
'   Couloirs 1-2-3 (décalés par les palettes) : bonus x2 … x5 et MYSTERE allumé au trou du centre.
'   MYSTERE : une récompense au hasard (25 000, kickback, extra ball allumée, bonus +1, 50 000, multiball).
'   Q-U-A-T (cibles debout de gauche) : KICKBACK allumé dans la sortie gauche.
'   Rampe : 5 000 ; 3 rampes = MULTIBALL (3 billes) allumé au trou. Multiball : rampe = JACKPOT (30 000, +10 000).
Dim couloirs(2), quatre(3), mystereAllume, mbAllume, rampes, jackpot, kickbackAllume

Sub R_Partie() : rampes = 0 : jackpot = 30000 : End Sub

Sub R_Bille()
  Dim i
  For i = 0 To 2 : couloirs(i) = False : Next
  For i = 0 To 3 : quatre(i) = False : Next
  mystereAllume = False : mbAllume = False
  AllumerKickback (bille = 1)              ' kickback offert à la première bille
End Sub

Sub AllumerKickback(oui)
  kickbackAllume = oui
  Kickback.Enabled = oui
End Sub

Sub R_FinMultiball() : Say "FIN DU MULTIBALL", 1500 : End Sub
Function R_Info() : R_Info = "" : End Function
Function R_Etat() : R_Etat = "mystereAllume=" & mystereAllume & " mb=" & mbAllume & " rampes=" & rampes & " jackpot=" & jackpot & " kickback=" & kickbackAllume & " extra=" & extraLit & " mult=" & mult : End Function

Sub R_Palette(sens)
  Dim a
  If sens < 0 Then
    a = couloirs(0) : couloirs(0) = couloirs(1) : couloirs(1) = couloirs(2) : couloirs(2) = a
  Else
    a = couloirs(2) : couloirs(2) = couloirs(1) : couloirs(1) = couloirs(0) : couloirs(0) = a
  End If
End Sub

Sub R_Lampes()
  Dim i
  For i = 0 To 2 : lampe(LP_haut0 + i) = B2E(couloirs(i)) : Next
  For i = 0 To 3 : lampe(LP_cq + i) = B2E(quatre(i)) : Next
  If mystereAllume Or mbAllume Or extraLit Then lampe(LP_mystere) = 2
  If multiball Then lampe(LP_mb) = 1 Else lampe(LP_mb) = 2 * B2E(mbAllume)
  If multiball Then lampe(LP_rampe) = 2 Else lampe(LP_rampe) = B2E(rampes Mod 3 = 2)
  lampe(LP_kickback) = B2E(kickbackAllume)
  lampe(LP_haute) = 1
  lampe(LP_extra) = B2E(extraBalls > 0)
  For i = 2 To 5 : lampe(LP_x2 + i - 2) = B2E(mult >= i) : Next
  If maintenant < ballSaveUntil Then lampe(LP_sauve) = 2
End Sub

Sub Regle(nom)
  Select Case nom
    Case "Bumper1", "Bumper2", "Bumper3" : Ajouter 100, 0 : Son "bumper"
    Case "LanceG", "LanceD" : Ajouter 10, 0 : Son "lance_pierre"
    Case "SortieG", "SortieD" : Ajouter 1000, 1000 : Son "couloir"
    Case "RetourG", "RetourD" : Ajouter 500, 500 : Son "couloir"
    Case "Haut1" : Couloir 0
    Case "Haut2" : Couloir 1
    Case "Haut3" : Couloir 2
    Case "CibleQ" : Quat 0
    Case "CibleU" : Quat 1
    Case "CibleA" : Quat 2
    Case "CibleT" : Quat 3
    Case "Mystere" : AuMystere
    Case "CapteurRampe" : Rampe
    Case "Kickback"
      Son "ejection" : Ajouter 2500, 0 : Say "KICKBACK", 1200
      Kickback.Kick 0, 42
      AllumerKickback False
  End Select
End Sub

Sub Couloir(i)
  Ajouter 500, 1000 : Son "couloir"
  couloirs(i) = True
  If couloirs(0) And couloirs(1) And couloirs(2) Then
    couloirs(0) = False : couloirs(1) = False : couloirs(2) = False
    Son "couloirs_faits" : MultBonus
    If Not mystereAllume Then mystereAllume = True : Say "MYSTERE ALLUME", 2000
  End If
End Sub

Sub Quat(i)
  Ajouter 1000, 1000 : Son "cible"
  quatre(i) = True
  If quatre(0) And quatre(1) And quatre(2) And quatre(3) Then
    For i = 0 To 3 : quatre(i) = False : Next
    Son "banque" : Ajouter 5000, 5000
    If Not kickbackAllume Then AllumerKickback True : Say "KICKBACK ALLUME", 2000
  End If
End Sub

Sub AuMystere()
  Son "trou"
  Ajouter 1000, 0
  If mbAllume And Not multiball Then
    mbAllume = False : Say "MULTIBALL", 3000 : LancerMultiball 3
  ElseIf extraLit Then
    DonnerExtra
  ElseIf mystereAllume Then
    mystereAllume = False
    Son "mode"
    Select Case Int(Rnd * 6)
      Case 0 : Ajouter 25000, 0 : Say "MYSTERE 25000", 2500
      Case 1 : AllumerKickback True : Say "MYSTERE KICKBACK", 2500
      Case 2 : AllumerExtra
      Case 3 : MultBonus
      Case 4 : Ajouter 50000, 0 : Say "MYSTERE 50000", 2500
      Case 5 : If Not multiball Then mbAllume = True : Say "MYSTERE MULTIBALL", 2500 Else Ajouter 25000, 0
    End Select
  End If
  Ejecter "Mystere", 1500
End Sub

Sub Rampe()
  Son "rampe"
  rampes = rampes + 1
  If multiball Then
    Ajouter jackpot, 0 : Say "JACKPOT " & jackpot, 2500 : Son "jackpot" : jackpot = jackpot + 10000
  Else
    Ajouter 5000, 2500
    If rampes Mod 3 = 0 Then mbAllume = True : Say "MULTIBALL AU MYSTERE", 2500
  End If
End Sub

Dim SCENARIO : SCENARIO = Array("Bumper1", "Haut1", "Haut2", "Haut3", "Mystere", "CibleQ", "CibleU", "CibleA", "CibleT", _
  "CapteurRampe", "CapteurRampe", "CapteurRampe", "Mystere", "CapteurRampe", "Haut1", "Haut2", "Haut3", "Mystere", "SortieG")
