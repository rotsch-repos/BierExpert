<?php

declare(strict_types=1);

/**
 * Spiegelt den GESAMTEN Bestand der Workstation zum Hoster.
 *
 * Aufruf:  php deploy/lokal/abgleich-alle.php
 *
 * Der laufende Betrieb braucht das nicht — dort spiegelt jedes Bier sich
 * selbst, in dem Augenblick, in dem es entsteht. Dieses Skript ist für die
 * zwei Momente davor und danach: das erstmalige Befüllen des Notvorrats
 * mit allem, was vor dem Spiegel entstand, und das Nachholen, falls der
 * Hoster eine Weile nicht erreichbar war und einzelne Spiegelungen ins
 * Leere liefen.
 *
 * Es läuft auf der Workstation gegen den ausgelieferten Stand — denselben
 * Code, der auch im Betrieb spiegelt. Zwei Fassungen der Spiegellogik
 * drifteten auseinander; eine tut es nicht.
 */

if (PHP_SAPI !== 'cli') {
    exit(1);
}

require '/srv/bierexpert/aktuell/api/intern/pforte.php';

$db = datenbank();

if ($db === null) {
    fwrite(STDERR, "Keine Datenbankverbindung.\n");
    exit(1);
}

if (abgleichAdresse() === '') {
    fwrite(STDERR, "Keine abgleich.adresse in der Konfiguration — nichts zu tun.\n");
    exit(1);
}

$kennungen = $db->query('SELECT id, name FROM biere ORDER BY id')->fetchAll();

printf("Spiegle %d Biere nach %s\n", count($kennungen), abgleichAdresse());

foreach ($kennungen as $bier) {
    bierSpiegeln((int) $bier['id']);
    printf("  %d  %s\n", (int) $bier['id'], (string) $bier['name']);
}

echo "Fertig.\n";
