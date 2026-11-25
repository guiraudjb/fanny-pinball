' ---------------------------------------------------------------- règles : DOUBLE RAMPE
'   Rampe : 2 500. Rampe de l'autre côté que la précédente : ALLER-RETOUR, 5 000 × nombre d'allers-retours.
'   6 allers-retours : MULTIBALL (2 billes) et JACKPOT allumé au trou du centre (50 000, +10 000).
'   Multiball : chaque rampe 10 000. Cibles rondes (les deux) : EXTRA BALL au trou (une fois par partie).
'   Couloirs du haut 1-2 (décalés par les palettes) : bonus x2 … x5. Tourniquet 100 (x2 en multiball).
Dim couloirs(1), rondes(1), derniere, allers, valJackpot, extraDonnee

Sub R_Partie() : valJackpot = 50000 : extraDonnee = False : End Sub

Sub R_Bille()
  couloirs(0) = False : couloirs(1) = False : rondes(0) = False : rondes(1) = False
  derniere = "" : allers = 0
End Sub

Sub R_FinMultiball() : Say "FIN DU MULTIBALL", 1500 : allers = 0 : derniere = "" : End Sub
Function R_Info()
  If allers > 0 And Not multiball Then R_Info = "ALLER-RETOUR " & allers Else R_Info = ""
End Function
Function R_Etat() : R_Etat = "allers=" & allers & " derniere=" & derniere & " valJackpot=" & valJackpot & " extra=" & extraLit & " mult=" & mult : End Function

Sub R_Palette(sens)
  Dim a : a = couloirs(0) : couloirs(0) = couloirs(1) : couloirs(1) = a
End Sub

Sub R_Lampes()
  Dim i
  lampe(LP_haut0) = B2E(couloirs(0)) : lampe(LP_haut1) = B2E(couloirs(1))
  lampe(LP_rondeg) = B2E(rondes(0)) : lampe(LP_ronded) = B2E(rondes(1))
  For i = 0 To 5 : lampe(LP_ar0 + i) = B2E(allers > i) : Next
  If multiball Then
    lampe(LP_rampeg) = 2 : lampe(LP_ramped) = 2 : lampe(LP_jackpot) = 2
  Else
    If derniere = "D" Then lampe(LP_rampeg) = 2 Else lampe(LP_rampeg) = 1
    If derniere = "G" Then lampe(LP_ramped) = 2 Else lampe(LP_ramped) = 1
  End If
  If extraLit Then lampe(LP_jackpot) = 2
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
    Case "RondeG" : Ronde 0
    Case "RondeD" : Ronde 1
    Case "Tourniquet" : Ajouter 100 * IIf(multiball, 2, 1), 10 : Son "tourniquet"
    Case "CapteurRampeG" : Rampe "G"
    Case "CapteurRampeD" : Rampe "D"
    Case "Jackpot" : AuJackpot
  End Select
End Sub

Sub Couloir(i)
  Ajouter 500, 1000 : Son "couloir"
  couloirs(i) = True
  If couloirs(0) And couloirs(1) Then couloirs(0) = False : couloirs(1) = False : Son "couloirs_faits" : MultBonus
End Sub

Sub Ronde(i)
  Ajouter 1000, 1000 : Son "cible"
  rondes(i) = True
  If rondes(0) And rondes(1) Then
    rondes(0) = False : rondes(1) = False : Son "banque"
    If Not extraDonnee Then extraDonnee = True : AllumerExtra
  End If
End Sub

Sub Rampe(cote)
  Son "rampe"
  If multiball Then Ajouter 10000, 2500 : Say "RAMPE 10000", 1200 : derniere = cote : Exit Sub
  If derniere <> "" And derniere <> cote Then
    allers = allers + 1
    Ajouter 5000 * allers, 2500 : Say "ALLER-RETOUR " & allers, 1800 : Son "combo"
    If allers >= 6 Then Say "MULTIBALL", 3000 : LancerMultiball 2
  Else
    Ajouter 2500, 1000
  End If
  derniere = cote
End Sub

Sub AuJackpot()
  Son "trou"
  If multiball Then
    Ajouter valJackpot, 0 : Say "JACKPOT " & valJackpot, 2500 : Son "jackpot" : valJackpot = valJackpot + 10000
  ElseIf extraLit Then
    DonnerExtra
  Else
    Ajouter 2000, 1000
  End If
  Ejecter "Jackpot", 1500
End Sub

Dim SCENARIO : SCENARIO = Array("Bumper1", "Haut1", "Haut2", "CapteurRampeG", "CapteurRampeD", "CapteurRampeG", "CapteurRampeG", _
  "CapteurRampeD", "CapteurRampeG", "CapteurRampeD", "CapteurRampeG", "Jackpot", "CapteurRampeD", "Jackpot", "Tourniquet", _
  "RondeG", "RondeD", "Jackpot", "SortieD")
