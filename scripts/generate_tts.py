#!/usr/bin/env python3
"""
Génère les fichiers audio d'aide pour l'interface utilisateur PWA.
Langues : FR, EN, ES, DE, AR
Sortie : public/audio/help/
"""

import subprocess
import os

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'public', 'audio', 'help')

VOICES = {
    'fr': 'fr-FR-DeniseNeural',
    'en': 'en-GB-SoniaNeural',
    'es': 'es-ES-ElviraNeural',
    'de': 'de-DE-KatjaNeural',
    'ar': 'ar-SA-ZariyahNeural',
}

TEXTS = {
    'fr': (
        "Bienvenue dans le système d'aide à l'écoute. "
        "Cette application vous permet d'écouter le spectacle avec une qualité audio renforcée. "
        "Choisissez un canal audio dans la liste, puis appuyez sur le bouton lecture. "
        "Vous pouvez régler le volume avec le curseur. "
        "Si le son s'arrête, appuyez à nouveau sur le bouton lecture. "
        "Pour toute assistance, adressez-vous au personnel de la salle."
    ),
    'en': (
        "Welcome to the audio accessibility system. "
        "This application allows you to listen to the performance with enhanced audio quality. "
        "Choose an audio channel from the list, then press the play button. "
        "You can adjust the volume using the slider. "
        "If the sound stops, press the play button again. "
        "For assistance, please speak to a member of staff."
    ),
    'es': (
        "Bienvenido al sistema de accesibilidad auditiva. "
        "Esta aplicación le permite escuchar el espectáculo con una calidad de audio mejorada. "
        "Elija un canal de audio de la lista y pulse el botón de reproducción. "
        "Puede ajustar el volumen con el control deslizante. "
        "Si el sonido se detiene, vuelva a pulsar el botón de reproducción. "
        "Para obtener ayuda, diríjase al personal de la sala."
    ),
    'de': (
        "Willkommen beim Audioassistenzsystem. "
        "Diese Anwendung ermöglicht es Ihnen, die Vorstellung mit verbesserter Audioqualität zu hören. "
        "Wählen Sie einen Audiokanal aus der Liste und drücken Sie die Wiedergabetaste. "
        "Sie können die Lautstärke mit dem Schieberegler einstellen. "
        "Wenn der Ton stoppt, drücken Sie erneut die Wiedergabetaste. "
        "Für Unterstützung wenden Sie sich bitte an das Personal."
    ),
    'ar': (
        "مرحباً بكم في نظام إمكانية الوصول الصوتي. "
        "يتيح لك هذا التطبيق الاستماع إلى العرض بجودة صوتية محسّنة. "
        "اختر قناة صوتية من القائمة، ثم اضغط على زر التشغيل. "
        "يمكنك ضبط مستوى الصوت باستخدام شريط التمرير. "
        "إذا توقف الصوت، اضغط على زر التشغيل مرة أخرى. "
        "للحصول على المساعدة، يرجى التحدث إلى أحد موظفي القاعة."
    ),
}

EDGE_TTS = os.path.expanduser('~/.local/bin/edge-tts')

def generate(lang, text, voice):
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    out_path = os.path.abspath(os.path.join(OUTPUT_DIR, f'help_{lang}.mp3'))
    result = subprocess.run(
        [EDGE_TTS, '--voice', voice, '--text', text, '--write-media', out_path],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        print(f'  [{lang.upper()}] ERREUR : {result.stderr.strip()}')
        return
    size = os.path.getsize(out_path)
    print(f'  [{lang.upper()}] {voice} -> help_{lang}.mp3 ({size//1024} ko)')

def main():
    print(f'Génération des fichiers audio TTS dans {os.path.abspath(OUTPUT_DIR)}\n')
    for lang in VOICES:
        generate(lang, TEXTS[lang], VOICES[lang])
    print('\nTerminé.')

if __name__ == '__main__':
    main()
