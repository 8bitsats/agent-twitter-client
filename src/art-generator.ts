import axios from 'axios';
import fs from 'fs';
import path from 'path';

export class ArtGenerator {
  private readonly openaiApiKey: string;
  private readonly outputDir: string;

  constructor(openaiApiKey: string) {
    this.openaiApiKey = openaiApiKey;
    this.outputDir = path.join(__dirname, '../generated-art');
    // Ensure output directory exists
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  async generateArt(prompt: string): Promise<string> {
    try {
      const response = await axios.post(
        'https://api.openai.com/v1/images/generations',
        {
          model: "dall-e-3",
          prompt,
          n: 1,
          size: "1024x1024",
          quality: "standard",
          response_format: "url"
        },
        {
          headers: {
            'Authorization': `Bearer ${this.openaiApiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const imageUrl = response.data.data[0].url;
      
      // Download the image
      const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
      const timestamp = Date.now();
      const imagePath = path.join(this.outputDir, `generated-${timestamp}.png`);
      
      fs.writeFileSync(imagePath, imageResponse.data);
      
      return imagePath;
    } catch (error) {
      console.error('Error generating art:', error);
      throw error;
    }
  }
}
