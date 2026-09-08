import React from 'react';
import { Image, StyleSheet } from 'react-native';

interface BrandLogoProps {
  size?: number;
}

/**
 * Official Aetheroll brand icon rendered from favicon.png
 */
export function BrandLogo({ size = 36 }: BrandLogoProps) {
  return (
    <Image
      source={require('../assets/favicon.png')}
      style={[styles.logo, { width: size, height: size }]}
      resizeMode="contain"
    />
  );
}

const styles = StyleSheet.create({
  logo: {
    borderRadius: 6,
  },
});
