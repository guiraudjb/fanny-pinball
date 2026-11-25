' ---------------------------------------------------------------- règles : UNIVERSELLE (base commune)
'   Planche et bas de table de Fanny Pinball, haut vierge : seuls les éléments du bas marquent.
'   Lance-pierres 10, couloirs de retour 500, sorties 1 000. Aucun insert lumineux.

Sub R_Partie() : End Sub
Sub R_Bille() : End Sub
Sub R_FinMultiball() : End Sub
Function R_Info() : R_Info = "" : End Function
Function R_Etat() : R_Etat = "mult=" & mult : End Function
Sub R_Palette(sens) : End Sub
Sub R_Lampes() : End Sub

Function Valeur(n) : Valeur = n : End Function

Sub Regle(nom)
  Select Case nom
    Case "LanceG", "LanceD" : Ajouter 10, 0 : Son "lance_pierre"
    Case "SortieG", "SortieD" : Ajouter 1000, 1000 : Son "couloir"
    Case "RetourExtG", "RetourExtD", "RetourIntG", "RetourIntD" : Ajouter 500, 500 : Son "couloir"
  End Select
End Sub

Dim SCENARIO : SCENARIO = Array("LanceG", "LanceD", "RetourExtG", "RetourIntG", "RetourIntD", "RetourExtD", "SortieG")
