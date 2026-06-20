from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0006_script_activity_log"),
    ]

    operations = [
        migrations.AddField(
            model_name="task",
            name="perceptual_hash",
            field=models.BigIntegerField(
                null=True,
                blank=True,
                help_text="dHash 256-bit da versão original (identificação visual sem EXIF)",
            ),
        ),
    ]
